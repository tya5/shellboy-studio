# Acceptance Validation

## Studio #134 shell intervention

- Unix stdin-delivery witness: exercises model shell-tool startup, open-stdin write/output before EOF, child-observed `READ:studio-input`, and EOF leaving the shell running.
- Windows stdin-delivery witness: not verified on Windows and reported as ignored, linked to Core Issue #415. Restore it when #415 is closed. Studio CI run 45484549556 failed at stage 1: child `READY` output was empty after 10 seconds, before any stdin write or EOF. The cause is unknown; no Windows machine was available for local diagnosis.
- The separate real-owner intervention effects test (background, interrupt, shell survival, stop) runs on Windows using its own shell that does not need stdin.
- The Activity row/UI mounted assertions remain unchanged and independent of this platform-specific real-owner witness.
