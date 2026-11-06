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
        | Command::OperationGet(..) => Access::Read,
        Command::ThreadCreate(..)
        | Command::MessageSend(..)
        | Command::RunStop(..)
        | Command::MessageCancel(..) => Access::Mutation,
        // `events.wait` is bridge-internal (one shared long-poll). The rest has no UI yet.
        Command::OwnerShutdown(..)
        | Command::ThreadBranches(..)
        | Command::UsageGet(..)
        | Command::CompactList(..)
        | Command::ThreadFork(..)
        | Command::ThreadDelete(..)
        | Command::ThreadDeletePreview(..)
        | Command::ThreadPrune(..)
        | Command::ThreadRewind(..)
        | Command::ThreadArchive(..)
        | Command::ThreadUnarchive(..)
        | Command::ThreadSet(..)
        | Command::MessageReply(..)
        | Command::RunRetry(..)
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
        | Command::IndexStatus(..)
        | Command::IndexPreview(..)
        | Command::IndexBackfill(..)
        | Command::IndexRetry(..)
        | Command::IndexRebuild(..)
        | Command::IndexProbe(..)
        | Command::StorageStatus(..)
        | Command::StorageCollect(..) => Access::Denied,
    }
}
