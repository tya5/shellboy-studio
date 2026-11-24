# Acceptance Validation

## Studio #134 shell intervention

- Unix real-owner witness: exercises model shell-tool startup, open-stdin write/output before EOF, child-observed `READ:studio-input`, EOF leaving the shell running, backgrounding, interruption, and stop.
- Windows real-owner witness: not verified on Windows. The test records a skip linked to Core Issue #415. Studio CI run 45484549556 failed at stage 1: child `READY` output was empty after 10 seconds, before any stdin write or EOF. The cause is unknown; no Windows machine was available for local diagnosis.
- Mounted UI behavior and other #134 assertions remain covered independently of this platform-specific real-owner witness.
