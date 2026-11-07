//! Bounded fan-out of owner change hints to browser sessions.
//!
//! Bounds (all fixed, none a performance claim):
//! - at most `MAX_SESSIONS` sessions (an upgrade beyond that is refused);
//! - at most `MAX_WATCH` watched Thread IDs per session, so a session's dirty set is at
//!   most `MAX_WATCH` IDs plus three flags; a slow tab gets one larger `changed` frame,
//!   never a growing backlog;
//! - no per-message queue: every update merges into the session's `Pending`.
//!
//! Owner of all state: the `Hub` (dropped with the server). No task is spawned here.
use crate::envelope::{OwnerEvent, OwnerInfo, OwnerState};
use crate::live::{self, Seen};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tokio::sync::Notify;

pub const MAX_SESSIONS: usize = 64;
pub const MAX_WATCH: usize = 64;
const MAX_ID_BYTES: usize = 128;

/// What a session has not been told yet.
#[derive(Debug, Default, PartialEq)]
pub struct Pending {
    pub owner: Option<OwnerEvent>,
    pub resync: bool,
    pub threads: BTreeSet<String>,
    pub list: bool,
}

impl Pending {
    pub fn is_empty(&self) -> bool {
        *self == Pending::default()
    }
}

struct Session {
    watch: HashSet<String>,
    list: bool,
    pending: Pending,
    wake: Arc<Notify>,
    /// Live text: what this tab has been sent per watched Thread, and which Threads to look at.
    live_seen: HashMap<String, Seen>,
    live_dirty: BTreeSet<String>,
}

struct Inner {
    next: u64,
    owner: OwnerState,
    sessions: HashMap<u64, Session>,
    live: live::Store,
}

pub struct Hub {
    inner: Mutex<Inner>,
}

/// Removes the session when dropped.
pub struct SessionGuard {
    hub: Arc<Hub>,
    id: u64,
    pub wake: Arc<Notify>,
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.hub.lock().sessions.remove(&self.id);
    }
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                next: 0,
                owner: OwnerState::Unreachable,
                sessions: HashMap::new(),
                live: live::Store::default(),
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// New session plus the owner state it starts from. Taken under one lock, so no owner
    /// event can fall between the snapshot and the session's first `Pending`.
    pub fn register(self: &Arc<Self>) -> Option<(SessionGuard, OwnerState)> {
        let mut inner = self.lock();
        if inner.sessions.len() >= MAX_SESSIONS {
            return None;
        }
        inner.next += 1;
        let id = inner.next;
        let wake = Arc::new(Notify::new());
        inner.sessions.insert(
            id,
            Session {
                watch: HashSet::new(),
                list: false,
                pending: Pending::default(),
                wake: wake.clone(),
                live_seen: HashMap::new(),
                live_dirty: BTreeSet::new(),
            },
        );
        let owner = inner.owner.clone();
        Some((
            SessionGuard {
                hub: self.clone(),
                id,
                wake,
            },
            owner,
        ))
    }

    pub fn session_count(&self) -> usize {
        self.lock().sessions.len()
    }

    pub fn owner_state(&self) -> OwnerState {
        self.lock().owner.clone()
    }

    /// Replace a session's subscription. Invalid input is refused whole.
    pub fn watch(
        &self,
        guard: &SessionGuard,
        thread_ids: Vec<String>,
        list: bool,
    ) -> Result<(), String> {
        if thread_ids.len() > MAX_WATCH {
            return Err(format!("at most {MAX_WATCH} thread_ids can be watched"));
        }
        if thread_ids
            .iter()
            .any(|id| id.is_empty() || id.len() > MAX_ID_BYTES)
        {
            return Err("thread_ids must be non-empty and short".into());
        }
        let mut inner = self.lock();
        let Inner { sessions, live, .. } = &mut *inner;
        if let Some(session) = sessions.get_mut(&guard.id) {
            session.watch = thread_ids.into_iter().collect();
            session.list = list;
            let watch = &session.watch;
            session.pending.threads.retain(|id| watch.contains(id));
            session.live_seen.retain(|id, _| watch.contains(id));
            session.live_dirty.retain(|id| watch.contains(id));
            // A tab that starts watching a Thread mid-attempt is sent what is held.
            for id in watch {
                if live.holds(id)
                    && !session.live_seen.contains_key(id)
                    && session.live_dirty.insert(id.clone())
                {
                    session.wake.notify_one();
                }
            }
            if !list {
                session.pending.list = false;
            }
        }
        Ok(())
    }

    /// Hints from the long-poll: mark dirty for sessions that watch the Thread or show the list.
    pub fn hint<'a>(&self, thread_ids: impl IntoIterator<Item = &'a str> + Clone) {
        let mut inner = self.lock();
        for session in inner.sessions.values_mut() {
            let mut touched = false;
            for id in thread_ids.clone() {
                if session.watch.contains(id) && session.pending.threads.insert(id.to_owned()) {
                    touched = true;
                }
                if session.list && !session.pending.list {
                    session.pending.list = true;
                    touched = true;
                }
            }
            if touched {
                session.wake.notify_one();
            }
        }
    }

    /// Everything a tab shows must be re-read; supersedes dirty marks.
    pub fn resync(&self) {
        let mut inner = self.lock();
        let Inner { sessions, live, .. } = &mut *inner;
        for session in sessions.values_mut() {
            session.pending.threads.clear();
            session.pending.list = false;
            session.pending.resync = true;
            // The tab discards its previews on `resync`, so it is sent what is held again.
            session.live_seen.clear();
            session.live_dirty = session
                .watch
                .iter()
                .filter(|id| live.holds(id))
                .cloned()
                .collect();
            session.wake.notify_one();
        }
    }

    /// Record the owner state and tell every session (the latest event wins).
    pub fn set_owner(&self, state: OwnerState, event: OwnerEvent) {
        let mut inner = self.lock();
        inner.owner = state;
        for session in inner.sessions.values_mut() {
            session.pending.owner = Some(event);
            session.wake.notify_one();
        }
    }

    /// Live text the owner listed in one reply (`reset`: a baseline or resync, which forgets
    /// what was held). Tabs watching a changed Thread are woken.
    pub fn live_apply(&self, entries: Vec<live::Entry>, reset: bool) {
        let mut inner = self.lock();
        let changed = inner.live.apply(entries, reset);
        Self::mark_live(&mut inner, &changed);
    }

    /// The owner is gone: nothing it held can be trusted. Tabs discard on the `owner` frame.
    pub fn live_clear(&self) {
        let mut inner = self.lock();
        inner.live.clear();
        for session in inner.sessions.values_mut() {
            session.live_seen.clear();
            session.live_dirty.clear();
        }
    }

    fn mark_live(inner: &mut Inner, changed: &[String]) {
        for session in inner.sessions.values_mut() {
            let mut touched = false;
            for id in changed {
                if session.watch.contains(id) {
                    touched |= session.live_dirty.insert(id.clone());
                }
            }
            if touched {
                session.wake.notify_one();
            }
        }
    }

    /// Frames for the Threads whose live text changed since the session was last told.
    pub fn take_live(&self, guard: &SessionGuard) -> Vec<live::Out> {
        let mut inner = self.lock();
        let Inner { sessions, live, .. } = &mut *inner;
        let Some(session) = sessions.get_mut(&guard.id) else {
            return Vec::new();
        };
        std::mem::take(&mut session.live_dirty)
            .into_iter()
            .filter_map(|id| {
                let mut seen = session.live_seen.get(&id).copied();
                let out = live.out(&id, &mut seen);
                match seen {
                    Some(s) => session.live_seen.insert(id, s),
                    None => session.live_seen.remove(&id),
                };
                out
            })
            .collect()
    }

    /// Take (and clear) what the session has not been told, with the owner state to send.
    pub fn take(&self, guard: &SessionGuard) -> (Pending, OwnerState) {
        let mut inner = self.lock();
        let owner = inner.owner.clone();
        let pending = inner
            .sessions
            .get_mut(&guard.id)
            .map(|s| std::mem::take(&mut s.pending))
            .unwrap_or_default();
        (pending, owner)
    }
}

pub fn connected(instance_id: Option<String>) -> OwnerState {
    OwnerState::Connected {
        info: OwnerInfo {
            protocol_version: shellboy::protocol::PROTOCOL_VERSION,
            instance_id,
            capabilities: crate::seam::owner_capabilities(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_coalesce_and_follow_the_subscription() {
        let hub = Hub::new();
        let (a, _) = hub.register().unwrap();
        let (b, _) = hub.register().unwrap();
        hub.watch(&a, vec!["t1".into()], false).unwrap();
        hub.watch(&b, vec![], true).unwrap();
        for _ in 0..1000 {
            hub.hint(["t1", "t2"]);
        }
        let (pa, _) = hub.take(&a);
        assert_eq!(pa.threads, BTreeSet::from(["t1".to_owned()]));
        assert!(!pa.list);
        let (pb, _) = hub.take(&b);
        assert!(pb.threads.is_empty());
        assert!(pb.list);
        assert!(hub.take(&a).0.is_empty());
    }

    #[test]
    fn resync_supersedes_dirty_marks_and_owner_latest_wins() {
        let hub = Hub::new();
        let (a, start) = hub.register().unwrap();
        assert_eq!(start, OwnerState::Unreachable);
        hub.watch(&a, vec!["t1".into()], true).unwrap();
        hub.hint(["t1"]);
        hub.set_owner(connected(Some("i".into())), OwnerEvent::Connected);
        hub.set_owner(OwnerState::Unreachable, OwnerEvent::Unreachable);
        hub.resync();
        let (p, owner) = hub.take(&a);
        assert!(p.resync && p.threads.is_empty() && !p.list);
        assert_eq!(p.owner, Some(OwnerEvent::Unreachable));
        assert_eq!(owner, OwnerState::Unreachable);
    }

    #[test]
    fn sessions_and_watch_are_bounded_and_release_on_drop() {
        let hub = Hub::new();
        let mut guards = Vec::new();
        for _ in 0..MAX_SESSIONS {
            guards.push(hub.register().unwrap().0);
        }
        assert!(hub.register().is_none());
        assert!(
            hub.watch(
                &guards[0],
                (0..=MAX_WATCH).map(|i| format!("t{i}")).collect(),
                false
            )
            .is_err()
        );
        assert!(hub.watch(&guards[0], vec![String::new()], false).is_err());
        guards.pop();
        assert_eq!(hub.session_count(), MAX_SESSIONS - 1);
        assert!(hub.register().is_some());
    }

    #[test]
    fn narrowing_the_watch_drops_stale_dirty_marks() {
        let hub = Hub::new();
        let (a, _) = hub.register().unwrap();
        hub.watch(&a, vec!["t1".into(), "t2".into()], true).unwrap();
        hub.hint(["t1", "t2"]);
        hub.watch(&a, vec!["t2".into()], false).unwrap();
        let (p, _) = hub.take(&a);
        assert_eq!(p.threads, BTreeSet::from(["t2".to_owned()]));
        assert!(!p.list);
    }

    #[test]
    fn live_text_follows_the_subscription_and_a_late_tab_gets_what_is_held() {
        use crate::live::{Delta, Entry, Out};
        let entry = |text: &str, offset: u64| Entry {
            thread_id: "t1".into(),
            attempt_id: "a".into(),
            gap: false,
            deltas: vec![Delta {
                offset,
                reasoning: false,
                text: text.into(),
            }],
        };
        let hub = Hub::new();
        let (a, _) = hub.register().unwrap();
        let (b, _) = hub.register().unwrap();
        hub.watch(&a, vec!["t1".into()], false).unwrap();
        hub.watch(&b, vec!["t2".into()], false).unwrap();
        for i in 0..1000 {
            hub.live_apply(vec![entry("x", i)], i == 0);
        }
        let frames = hub.take_live(&a);
        assert_eq!(frames.len(), 1, "1000 deltas are one frame");
        let Out::Text { deltas, .. } = &frames[0] else {
            panic!()
        };
        assert_eq!(deltas.len(), 1000);
        assert!(hub.take_live(&b).is_empty(), "not watching t1");
        hub.watch(&b, vec!["t1".into()], false).unwrap();
        assert_eq!(hub.take_live(&b).len(), 1, "late tab: what is held");
        hub.live_apply(vec![], false);
        assert_eq!(
            hub.take_live(&a),
            vec![Out::End {
                thread_id: "t1".into()
            }]
        );
        hub.live_apply(vec![entry("y", 0)], false);
        hub.live_clear();
        assert!(hub.take_live(&a).is_empty());
    }
}
