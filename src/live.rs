//! Bounded copy of the owner's live model text, shared by every tab.
//!
//! The owner (Shellboy #243 E3, events-and-external-protocol 2.5) keeps unsaved model text in
//! memory and returns it from `events.wait` when asked. The bridge's single poll feeds this
//! store; each tab is then sent only what it has not seen. The text is a lossy preview: never
//! saved here, never a source of truth, and it is dropped when the owner is lost.
//!
//! Owner of the state: the `Hub` (inside its lock). No task, no queue. Bounds, the owner's own
//! (not performance claims): at most `MAX_ATTEMPTS` attempts, each at most `MAX_ATTEMPT_BYTES`
//! of text counting `DELTA_OVERHEAD` per delta, oldest whole deltas dropped first. Per tab the
//! cost is one `Seen` per watched Thread (at most `hub::MAX_WATCH`) and one dirty mark each.
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

pub const MAX_ATTEMPTS: usize = 16;
pub const MAX_ATTEMPT_BYTES: usize = 64 * 1024;
const DELTA_OVERHEAD: usize = 40;

/// One run of text. `offset` counts Unicode scalar values already streamed by the attempt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Delta {
    pub offset: u64,
    pub reasoning: bool,
    pub text: String,
}

impl Delta {
    fn end(&self) -> u64 {
        self.offset + self.text.chars().count() as u64
    }
    fn cost(&self) -> usize {
        self.text.len() + DELTA_OVERHEAD
    }
}

/// What the owner lists for one attempt in one reply.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub thread_id: String,
    pub attempt_id: String,
    /// Text after the caller's position was lost.
    pub gap: bool,
    pub deltas: Vec<Delta>,
}

struct Attempt {
    id: String,
    /// Changes whenever earlier text may no longer line up (new attempt, or a gap).
    epoch: u64,
    gap: bool,
    deltas: VecDeque<Delta>,
    bytes: usize,
    end: u64,
}

impl Attempt {
    fn push(&mut self, delta: Delta) -> bool {
        let end = delta.end();
        if end <= self.end && !self.deltas.is_empty() {
            return false; // already held (a repeated baseline)
        }
        self.end = end;
        self.bytes += delta.cost();
        self.deltas.push_back(delta);
        while self.bytes > MAX_ATTEMPT_BYTES && self.deltas.len() > 1 {
            if let Some(old) = self.deltas.pop_front() {
                self.bytes -= old.cost();
            }
        }
        true
    }
}

/// What a tab has been sent for one Thread.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Seen {
    epoch: u64,
    end: u64,
}

/// A frame for one tab and one Thread.
#[derive(Debug, Clone, PartialEq)]
pub enum Out {
    Text {
        thread_id: String,
        attempt_id: String,
        gap: bool,
        deltas: Vec<Delta>,
    },
    /// No text is held for the Thread any more.
    End { thread_id: String },
}

#[derive(Default)]
pub struct Store {
    attempts: BTreeMap<String, Attempt>,
    next_epoch: u64,
}

impl Store {
    pub fn holds(&self, thread_id: &str) -> bool {
        self.attempts.contains_key(thread_id)
    }

    /// Apply the attempts the owner listed. `reset` (baseline, resync) forgets what was held
    /// first. A Thread the owner no longer lists is removed. Returns the Threads that changed.
    pub fn apply(&mut self, entries: Vec<Entry>, reset: bool) -> Vec<String> {
        let mut changed = Vec::new();
        if reset {
            changed.extend(std::mem::take(&mut self.attempts).into_keys());
        }
        let listed: Vec<String> = entries.iter().map(|e| e.thread_id.clone()).collect();
        let gone: Vec<String> = self
            .attempts
            .keys()
            .filter(|t| !listed.contains(t))
            .cloned()
            .collect();
        for thread in gone {
            self.attempts.remove(&thread);
            changed.push(thread);
        }
        for entry in entries {
            let same = self
                .attempts
                .get(&entry.thread_id)
                .is_some_and(|a| a.id == entry.attempt_id && !entry.gap);
            if !same {
                if !self.attempts.contains_key(&entry.thread_id)
                    && self.attempts.len() >= MAX_ATTEMPTS
                {
                    continue; // the owner holds at most this many; never grow past it
                }
                self.next_epoch += 1;
                self.attempts.insert(
                    entry.thread_id.clone(),
                    Attempt {
                        id: entry.attempt_id.clone(),
                        epoch: self.next_epoch,
                        gap: entry.gap,
                        deltas: VecDeque::new(),
                        bytes: 0,
                        end: 0,
                    },
                );
                changed.push(entry.thread_id.clone());
            }
            if let Some(attempt) = self.attempts.get_mut(&entry.thread_id) {
                let mut grew = false;
                for delta in entry.deltas {
                    grew |= attempt.push(delta);
                }
                if grew && same {
                    changed.push(entry.thread_id);
                }
            }
        }
        changed.sort();
        changed.dedup();
        changed
    }

    /// Forget everything (the owner is gone). Returns the Threads that held text.
    pub fn clear(&mut self) -> Vec<String> {
        std::mem::take(&mut self.attempts).into_keys().collect()
    }

    /// The frame a tab needs for a Thread, given what it has seen; updates `seen`.
    pub fn out(&self, thread_id: &str, seen: &mut Option<Seen>) -> Option<Out> {
        let Some(attempt) = self.attempts.get(thread_id) else {
            return seen.take().map(|_| Out::End {
                thread_id: thread_id.to_owned(),
            });
        };
        let fresh = seen.is_none_or(|s| s.epoch != attempt.epoch);
        let from = if fresh { 0 } else { seen.map_or(0, |s| s.end) };
        let lost = !fresh && attempt.deltas.front().is_some_and(|d| d.offset > from);
        let deltas: Vec<Delta> = attempt
            .deltas
            .iter()
            .filter(|d| fresh || lost || d.end() > from)
            .cloned()
            .collect();
        if !fresh && !lost && deltas.is_empty() {
            return None;
        }
        *seen = Some(Seen {
            epoch: attempt.epoch,
            end: attempt.end,
        });
        Some(Out::Text {
            thread_id: thread_id.to_owned(),
            attempt_id: attempt.id.clone(),
            gap: if fresh { attempt.gap } else { lost },
            deltas,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(offset: u64, text: &str) -> Delta {
        Delta {
            offset,
            reasoning: false,
            text: text.into(),
        }
    }
    fn e(thread: &str, attempt: &str, gap: bool, deltas: Vec<Delta>) -> Entry {
        Entry {
            thread_id: thread.into(),
            attempt_id: attempt.into(),
            gap,
            deltas,
        }
    }

    #[test]
    fn a_tab_gets_only_what_it_has_not_seen_and_offsets_count_characters() {
        let mut s = Store::default();
        let mut seen = None;
        assert_eq!(
            s.apply(vec![e("t", "a1", false, vec![d(0, "こん😀")])], false),
            ["t"]
        );
        let Some(Out::Text { deltas, gap, .. }) = s.out("t", &mut seen) else {
            panic!()
        };
        assert_eq!((deltas.len(), gap), (1, false));
        assert_eq!(s.out("t", &mut seen), None, "nothing new");
        // The same list again (a repeated baseline or a plain poll) changes nothing.
        assert!(
            s.apply(vec![e("t", "a1", false, vec![d(0, "こん😀")])], false)
                .is_empty()
        );
        assert_eq!(
            s.apply(vec![e("t", "a1", false, vec![d(3, "!")])], false),
            ["t"]
        );
        let Some(Out::Text { deltas, .. }) = s.out("t", &mut seen) else {
            panic!()
        };
        assert_eq!(deltas, vec![d(3, "!")]);
    }

    #[test]
    fn a_gap_or_a_new_attempt_starts_over_and_an_ended_attempt_ends() {
        let mut s = Store::default();
        let mut seen = None;
        s.apply(vec![e("t", "a1", false, vec![d(0, "abc")])], false);
        s.out("t", &mut seen);
        s.apply(vec![e("t", "a1", true, vec![d(10, "z")])], false);
        let Some(Out::Text { deltas, gap, .. }) = s.out("t", &mut seen) else {
            panic!()
        };
        assert!(gap, "the tab discards first");
        assert_eq!(deltas, vec![d(10, "z")]);
        s.apply(vec![e("t", "a2", false, vec![d(0, "new")])], false);
        let Some(Out::Text {
            attempt_id, gap, ..
        }) = s.out("t", &mut seen)
        else {
            panic!()
        };
        assert_eq!((attempt_id.as_str(), gap), ("a2", false));
        assert_eq!(s.apply(vec![], false), ["t"]);
        assert_eq!(
            s.out("t", &mut seen),
            Some(Out::End {
                thread_id: "t".into()
            })
        );
        assert_eq!(s.out("t", &mut seen), None);
    }

    #[test]
    fn a_tab_that_fell_behind_the_bound_is_told_of_the_loss() {
        let mut s = Store::default();
        let mut seen = None;
        let big = "x".repeat(MAX_ATTEMPT_BYTES / 2);
        s.apply(vec![e("t", "a", false, vec![d(0, "ab")])], false);
        s.out("t", &mut seen);
        let n = big.chars().count() as u64;
        s.apply(
            vec![e(
                "t",
                "a",
                false,
                vec![d(2, &big), d(2 + n, &big), d(2 + 2 * n, &big)],
            )],
            false,
        );
        let Some(Out::Text { gap, deltas, .. }) = s.out("t", &mut seen) else {
            panic!()
        };
        assert!(gap);
        assert!(
            deltas.iter().map(|d| d.text.len() + 40).sum::<usize>()
                <= MAX_ATTEMPT_BYTES + big.len()
        );
    }

    #[test]
    fn attempts_are_bounded_and_reset_and_clear_forget() {
        let mut s = Store::default();
        let many: Vec<Entry> = (0..MAX_ATTEMPTS + 5)
            .map(|i| e(&format!("t{i:02}"), "a", false, vec![d(0, "x")]))
            .collect();
        s.apply(many, false);
        assert_eq!(s.attempts.len(), MAX_ATTEMPTS);
        let changed = s.apply(vec![e("t00", "a", false, vec![d(0, "x")])], true);
        assert!(changed.contains(&"t00".to_owned()) && s.attempts.len() == 1);
        assert_eq!(s.clear(), ["t00"]);
        assert!(!s.holds("t00"));
    }
}
