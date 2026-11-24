# Acceptance Validation

## Studio #134 shell intervention

- Unix stdin-delivery witness: exercises model shell-tool startup, open-stdin write/output before EOF, child-observed `READ:studio-input`, and EOF leaving the shell running.
- Windows stdin-delivery witness: not verified on Windows and reported as ignored, linked to Core Issue #415. Restore it when #415 is closed. Studio CI run 45484549556 failed at stage 1: child `READY` output was empty after 10 seconds, before any stdin write or EOF. The cause is unknown; no Windows machine was available for local diagnosis.
- The separate real-owner intervention effects test (background, interrupt, shell survival, stop) runs on Windows using its own shell that does not need stdin.
- The Activity row/UI mounted assertions remain unchanged and independent of this platform-specific real-owner witness.

## Branches family and selected path (#142)

With Core v0.16.0 (`46212b5391e2d486efec770291359a2ba671fa01`, protocol 26),
`thread.branches` does not report the selected-path revision. Studio checks the
family tip and size and agreement between window revisions. The mounted
synthetic tests exercise discarded rounds for a visible disagreement; they do
not establish a shared path revision or physical-device behavior.

Accepted: a same-length interior rewrite that preserves the tip between the
family response and first window can transiently leave stale split geometry.
Core refuses actions on nodes that left the path; the next change mark
refreshes the graph. Studio does not add bracketing reads or infer a revision.
Revisit when [Core #418](https://github.com/tya5/shellboy/issues/418) has landed
and Studio pins a Core version that exposes the field.
