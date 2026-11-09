# Physical Phone Operation Checklist (#10)

Status: unexecuted manual plan, not physical-device acceptance or a release gate.
[Issue #10](https://github.com/tya5/shellboy-studio/issues/10) owns these gaps.
This documentation task did not operate a phone, owner, browser, or paid provider.

## Keep The Two Targets Separate

- Published Studio v0.1.0: `1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, paired
  with Core v0.11.0 `4dc8f66a6c586db57a7a63a3a8be84e25999c95f`.
  Use the [published evidence and limitations](../first-release-verification.md#published-v010-outcome),
  not later main tests, to describe its immutable downloaded archives.
- Current-source plan baseline: `dd9372b338d0be0bae6bb475145d8131b23192da`.
  Later source fixes are not proof that a running bridge or v0.1.0 archive has
  those fixes. Record the actually served Studio/Core identities before testing.
- Reuse the eight-item scope reconciliation, coordinator candidate commit
  `47e437b81499ab7c939e9a449727e95bae4f6f10`, file
  `docs/development/public-release-scope.md`. It is not in this base tree yet;
  the coordinator should add a relative link when both docs are integrated.
  Do not claim this local candidate URL is already public or embedded in release
  archives, and do not duplicate its CI/asset/privacy/attribution tables here.

Existing evidence below means recorded synthetic/headless/source evidence, not
new testing in this task. CI OS builds, 390px emulation and author frame
observations do not establish touch, physical IME, visual approval or phone PASS.

## Operator Record (Complete Only When Separately Authorized)

For each target record date/operator, device model, OS version, browser/version,
standalone/PWA/tab mode, viewport/orientation, virtual/physical keyboard, input
language, served Studio SHA/version and Core SHA/version, connection transport,
auth mode, synthetic fixture identity, actual result and sanitized evidence link.
Use disposable synthetic data; do not publish tokens, hostnames, private paths,
messages or screenshots containing them. This plan does not authorize owner
startup/replacement, Tailscale/LAN changes, authentication changes or installation.
If no authorized isolated setup is available, leave every result unverified.

| Operation | Action and expected observation (not a measured guarantee) | Current evidence / scope | Physical result |
| --- | --- | --- | --- |
| IME composition | Compose Japanese, select candidates, cancel, then commit. Composition Enter must not send; explicit post-commit send sends the intended synthetic text once. Repeat with a hardware keyboard if available. | Existing web tests/headless checks do not establish the device's composition events. | Not performed |
| Keyboard | Open/dismiss virtual keyboard; edit multiline text and use explicit send. Confirm focused control, caret and send/stop remain reachable, with no accidental action on dismissal. | Published first-run/headless acceptance is not physical keyboard coverage. | Not performed |
| Viewport | Portrait/landscape and keyboard-visible viewport; inspect composer, dialogs and warning. No essential control clipped or hidden behind browser/keyboard chrome. | Responsive/390px evidence only; no phone safe-area proof. | Not performed |
| Manual scroll | During synthetic updates, scroll upward and remain reading the selected content. No forced jump to the tail; verify after switching back to the conversation. | Existing scroll/C1 evidence is limited; residuals tracked in [#6](https://github.com/tya5/shellboy-studio/issues/6). | Not performed |
| Tail follow | At the tail, observe new synthetic text, then leave the tail and use the offered return-to-tail action. It follows only while intended; no blank/duplicated body during supported handoff. Unsupported exact-item bodies remain honest, never guessed. | Main source repairs differ from published tag; general body limits remain [#5](https://github.com/tya5/shellboy-studio/issues/5). Synthetic/frame evidence is not physical PASS. | Not performed |
| Selection | Long-press/select/copy a harmless passage while updates arrive. Selection and copy remain intentional and scrolling does not trigger send. Record platform-specific selection behavior, not guessed clipboard success. | No recorded physical selection/clipboard acceptance. | Not performed |
| Connection switch | Switch between already-authorized isolated mock connections/Threads, then return. Correct target/state is visible; no stale answer is attributed to the new target and drafts are not silently sent. | Exact-pair/first-run synthetic evidence is narrower than phone switching behavior. Do not create/edit real credentials. | Not performed |
| No-auth warning | Only if an authorized test setup already runs explicit no-auth: inspect the documented warning at narrow width and after navigation/theme changes. It stays visible and truthful; normal authenticated mode is not relabelled. | [User Guide restrictions](../guides/user-guide.md#explicit-development-authentication-opt-out); existing narrow HTTP checks do not prove phone layout or WebSocket safety. [#4](https://github.com/tya5/shellboy-studio/issues/4) remains separate. | Not performed |
| Both themes | Repeat critical controls, warning, selection and conversation reading in light and dark; inspect auto theme separately if offered. Text/icons remain distinguishable; record actual device screenshots only with permission and sanitized fixtures. | Source/asset evidence is not visual or contrast approval; logo/theme residuals tracked in [#11](https://github.com/tya5/shellboy-studio/issues/11). | Not performed |

Mark a row PASS only for the specific device/browser/served identities actually
observed. Record failure or unsupported behavior without silently changing the
expected behavior, retrying until green, or substituting emulated evidence.
Physical Safari/Firefox, assistive technology, PWA installation, remote HTTPS and
upgrade behavior need their own explicit records; this short table does not
claim they are covered. Any future synthetic regression candidates remain
separate from the physical result column and do not close #10 by themselves.
