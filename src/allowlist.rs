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
    }
}
