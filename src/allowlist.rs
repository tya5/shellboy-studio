//! Operation allowlist (M1). One exhaustive `match`, not a registry: a new Shellboy
//! `Command` variant does not compile until someone decides whether the UI offers it.
use shellboy::protocol::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Read,
    Mutation,
    Denied,
}

pub fn access(command: &Command) -> Access {
    match command {
        Command::Status(..)
        | Command::ModelList(..)
        | Command::ThreadList(..)
        | Command::ThreadGet(..)
        | Command::RunGet(..)
        | Command::TurnGet(..)
        | Command::MessageGet(..)
        | Command::ShellList(..)
        | Command::ShellGet(..)
        | Command::ShellRead(..)
        | Command::HistoryList(..)
        | Command::HistoryGet(..)
        | Command::OperationGet(..)
        // Analytics and Settings: saved facts only, no provider request and no receipt.
        | Command::UsageGet(..)
        | Command::CompactList(..)
        | Command::IndexStatus(..)
        | Command::StorageStatus(..)
        // Branches view.
        | Command::ThreadBranches(..) => Access::Read,
        Command::ThreadCreate(..)
        | Command::MessageSend(..)
        | Command::RunStop(..)
        | Command::MessageCancel(..)
        | Command::RunRetry(..)
        | Command::ThreadArchive(..)
        // Branches and Threads views. A rewind is shown as a dry run first (`dry_run`).
        | Command::ThreadFork(..)
        | Command::ThreadRewind(..)
        | Command::ThreadUnarchive(..) => Access::Mutation,
        // Moving a Thread, and nothing else `thread.set` can do. Needs an owner newer than the pin.
        #[cfg(feature = "next-shellboy")]
        Command::ThreadSet(args) if only_parent(args) => Access::Mutation,
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
        // The key is write-only: the owner never returns it. Nothing here logs arguments.
        #[cfg(feature = "next-connection-setup")]
        Command::CredentialsSet(..) | Command::CredentialsClear(..) => Access::Mutation,
        // `events.wait` is bridge-internal (one shared long-poll). The rest has no UI yet.
        Command::OwnerShutdown(..)
        | Command::ThreadDelete(..)
        | Command::ThreadDeletePreview(..)
        | Command::ThreadPrune(..)
        | Command::ThreadSet(..)
        | Command::MessageReply(..)
        | Command::Wait(..)
        | Command::EventsWait(..)
        | Command::HistorySearch(..)
        | Command::HistoryRelations(..)
        | Command::ShellWrite(..)
        | Command::ShellEof(..)
        | Command::ShellStop(..)
        | Command::AttachmentAdd(..)
        | Command::AttachmentList(..)
        | Command::AttachmentRemove(..)
        | Command::CompactPreview(..)
        | Command::Compact(..)
        | Command::ContextEdit(..)
        | Command::IndexPreview(..)
        | Command::IndexBackfill(..)
        | Command::IndexRetry(..)
        | Command::IndexRebuild(..)
        | Command::IndexProbe(..)
        | Command::StorageCollect(..) => Access::Denied,
        #[cfg(feature = "next-shellboy")]
        Command::IndexShrink(..) | Command::IndexRemove(..) => Access::Denied,
    }
}

#[cfg(feature = "next-shellboy")]
fn only_parent(args: &shellboy::protocol::ThreadSetArgs) -> bool {
    let mut rest = args.clone();
    rest.thread_id = None;
    let has_parent = rest.parent_id.take().is_some();
    has_parent && rest == Default::default()
}
