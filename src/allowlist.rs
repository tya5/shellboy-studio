//! Operation allowlist (M1). One exhaustive `match`, not a registry: a new Shellboy
//! `Command` variant does not compile until someone decides whether the UI offers it.
use shellboy::protocol::{Command, Deliver};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Mutation,
    Denied,
}

pub fn access(command: &Command) -> Access {
    match command {
        Command::ScheduleList(args) | Command::ServiceList(args)
            if args.thread_id.as_ref().is_some_and(|id| !id.is_empty()) => Access::Read,
        Command::ScheduleList(..) | Command::ServiceList(..) => Access::Denied,
        Command::ScheduleEnable(..) | Command::ScheduleDisable(..) | Command::ScheduleRemove(..)
        | Command::ServiceStart(..) | Command::ServiceStop(..) => Access::Mutation,
        Command::Status(..)
        | Command::ModelList(..)
        | Command::ThreadList(..)
        | Command::ThreadGet(..)
        | Command::RunGet(..)
        | Command::TurnGet(..)
        | Command::MessageGet(..)
        | Command::MessageList(..)
        | Command::ShellList(..)
        | Command::ShellGet(..)
        | Command::ShellRead(..)
        | Command::ArtifactList(..)
        | Command::ArtifactGet(..)
        | Command::HistoryList(..)
        | Command::HistoryRead(..)
        | Command::OperationGet(..)
        // Analytics and Settings: saved facts only, no provider request and no receipt.
        | Command::UsageGet(..)
        | Command::CompactList(..)
        | Command::IndexStatus(..)
        | Command::StorageStatus(..)
        // Branches view.
        | Command::ThreadBranches(..) => Access::Read,
        Command::MessageSend(args) if args.deliver != Deliver::Next => Access::Denied,
        Command::ThreadCreate(..)
        | Command::MessageSend(..)
        | Command::RunStop(..)
        | Command::TurnInterrupt(..)
        | Command::MessageCancel(..)
        | Command::RunRetry(..)
        | Command::ThreadArchive(..)
        // Branches view. A rewind is shown as a dry run first (`dry_run`).
        | Command::ThreadFork(..)
        | Command::ThreadRewind(..)
        | Command::ThreadUnarchive(..) => Access::Mutation,
        // Moving a Thread, and nothing else `thread.set` can do. Needs an owner newer than the pin.
        #[cfg(feature = "next-shellboy")]
        Command::ThreadSet(args) if only_parent(args) || only_model(args) || only_title(args) || only_cwd(args) => Access::Mutation,
        // Settings. The owner redacts what it returns and refuses what it can't accept. Apps
        // have no way to reach these: `apps.call` has its own list.
        #[cfg(feature = "next-shellboy")]
        Command::ConfigGet(..) => Access::Read,
        // The long-thread reader (#268): a positional window of the selected path. Read only.
        #[cfg(feature = "next-shellboy")]
        Command::HistoryWindow(..) => Access::Read,
        #[cfg(feature = "next-shellboy")]
        Command::ConfigSet(..) => Access::Mutation,
        // First-run connection setup (#269). One model-list GET, no state change on the owner.
        #[cfg(feature = "next-connection-setup")]
        Command::ConnectionTest(..) => Access::Read,
        // Tags (#222 stage 3). `thread.tag` changes only tag rows; `thread.tags` lists names, no counts.
        #[cfg(feature = "next-tags")]
        Command::ThreadTags(..) => Access::Read,
        #[cfg(feature = "next-tags")]
        Command::ThreadTag(..) => Access::Mutation,
        Command::AttachmentList(args)
            if args.thread_id.as_ref().is_some_and(|id| !id.is_empty())
                && (1..=200).contains(&args.limit) => Access::Read,
        Command::AttachmentList(..) => Access::Denied,
        // The distinct working directories, assumed to read like `thread.tags`.
        #[cfg(feature = "next-cwds")]
        Command::ThreadCwds(..) => Access::Read,
        // The key is write-only: the owner never returns it. Nothing here logs arguments.
        #[cfg(feature = "next-connection-setup")]
        Command::CredentialsSet(..) | Command::CredentialsClear(..) => Access::Mutation,
        Command::MessageReply(..)
        | Command::ShellStop(..)
        | Command::ShellBackground(..) => Access::Mutation,
        Command::ThreadDeletePreview(args) if !args.thread_id.is_empty() && !args.descendants && args.preview_marker.is_none() => Access::Read,
        Command::ThreadDelete(args) if !args.thread_id.is_empty() && !args.descendants && args.preview_marker.as_ref().is_some_and(|m| m.thread_count == 1 && m.ids_hash.len() == 64 && m.ids_hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())) => Access::Mutation,
        Command::ThreadDeleteSetPreview(..) => Access::Read,
        Command::ThreadDeleteSet(args) if args.preview_marker.thread_count as usize == args.thread_ids.len() && args.preview_marker.ids_hash.len() == 64 && args.preview_marker.ids_hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) => Access::Mutation,
        Command::ThreadDeleteSet(..) => Access::Denied,
        // Core's id.resolve is CLI-only; the browser never receives this identity lookup.
        Command::MessageAsk(..) | Command::IdResolve(..) => Access::Denied,
        // `events.wait` is bridge-internal (one shared long-poll). The rest has no UI yet.
        Command::OwnerShutdown(args) if !args.instance_id.is_empty() => Access::Mutation,
        Command::ShellWrite(..)
        | Command::ShellEof(..)
        | Command::OwnerShutdown(..)
        | Command::ThreadDelete(..)
        | Command::ThreadDeletePreview(..)
        | Command::ThreadPrune(..)
        | Command::ThreadSet(..)
        | Command::Wait(..)
        | Command::EventsWait(..)
        | Command::HistorySearch(..)
        | Command::HistoryRelations(..)
        | Command::ArtifactAdd(..)
        | Command::ArtifactUpdate(..)
        | Command::ArtifactRemove(..)
        | Command::AttachmentAdd(..)
        | Command::AttachmentRemove(..)
        | Command::CompactPreview(..)
        | Command::Compact(..)
        | Command::ContextEdit(..)
        | Command::ScheduleAdd(..)
        | Command::ScheduleSet(..)
        // Service endpoint data (including its token) is internal to Apps; service configuration
        // reads and writes are not exposed by the general Web UI.
        | Command::ServiceGet(..)
        | Command::ServiceSet(..)
        | Command::ServiceEndpoint(..)
        | Command::IndexPreview(..)
        | Command::IndexBackfill(..)
        | Command::IndexRetry(..)
        | Command::IndexRebuild(..)
        | Command::IndexProbe(..)
        | Command::StorageCollect(..) => Access::Denied,
        #[cfg(feature = "next-shellboy")]
        Command::DraftImage(..)
        | Command::DraftSave(..)
        | Command::DraftGet(..)
        | Command::DraftRestore(..)
        | Command::DraftSubmit(..)
        | Command::HistoryRecall(..)
        | Command::HistoryReceived(..)
        | Command::IndexShrink(..)
        | Command::IndexRemove(..)
        | Command::ThreadImport(..)
        | Command::HistoryExport(..)
        | Command::ServiceAdd(..)
        | Command::ServiceRemove(..)
        | Command::ArtifactRead(..) => Access::Denied,
    }
}

#[cfg(feature = "next-shellboy")]
fn only_parent(args: &shellboy::protocol::ThreadSetArgs) -> bool {
    let mut rest = args.clone();
    rest.thread_id = None;
    let has_parent = rest.parent_thread_id.take().is_some();
    has_parent && rest == Default::default()
}

#[cfg(feature = "next-shellboy")]
fn only_model(args: &shellboy::protocol::ThreadSetArgs) -> bool {
    let mut rest = args.clone();
    if rest.thread_id.as_deref().is_none_or(str::is_empty) {
        return false;
    }
    rest.thread_id = None;
    let has_change = rest.model.take().is_some()
        | rest.connection.take().is_some()
        | rest.effort.take().is_some()
        | rest.auto_compact_at.take().is_some()
        | rest.agents.take().is_some()
        | rest.max_tokens.take().is_some()
        | rest.auto_compact_target_percent.take().is_some()
        | rest.summary_max_chars.take().is_some()
        | rest.spill.take().is_some();
    has_change && rest == Default::default()
}

#[cfg(feature = "next-shellboy")]
fn only_cwd(args: &shellboy::protocol::ThreadSetArgs) -> bool {
    let mut rest = args.clone();
    if rest.thread_id.as_deref().is_none_or(str::is_empty) {
        return false;
    }
    rest.thread_id = None;
    rest.cwd.take().is_some() && rest == Default::default()
}

#[cfg(feature = "next-shellboy")]
fn only_title(args: &shellboy::protocol::ThreadSetArgs) -> bool {
    let mut rest = args.clone();
    if rest.thread_id.as_deref().is_none_or(str::is_empty) {
        return false;
    }
    rest.thread_id = None;
    let title = rest.title.take().is_some();
    title && rest == Default::default()
}
