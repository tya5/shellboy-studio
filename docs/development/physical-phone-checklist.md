# Physical Phone Operation Checklist (#10)

Status: unexecuted manual plan, not physical-device acceptance or a release gate.
[Issue #10](https://github.com/tya5/shellboy-studio/issues/10) owns these gaps.
This documentation task did not operate a phone, owner, browser, or paid provider.
It reconciles existing records only; it does not rerun frame tests or implement
authentication changes.

## Keep The Two Targets Separate

- Published Studio v0.1.0: `1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, paired
  with Core v0.11.0 `4dc8f66a6c586db57a7a63a3a8be84e25999c95f`.
  Use the [published evidence and limitations](../first-release-verification.md#published-v010-outcome),
  not later main tests, to describe its immutable downloaded archives.
- Current-source plan baseline: `be5a8e76786d344d4e90707c105f66a10ba273f0`.
  Later source fixes are not proof that a running bridge or v0.1.0 archive has
  those fixes. Record the actually served Studio/Core identities before testing.
- Reuse the [eight-item scope reconciliation](public-release-scope.md),
  originally reviewed at `47e437b81499ab7c939e9a449727e95bae4f6f10`.
  The document is present in this combined source tree; that does not put it in
  immutable release archives. Do not duplicate its CI/asset/privacy/attribution
  tables here.

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

## Evidence Classification At This Source Baseline

The categories below are independent: a supported synthetic observation can
coexist with an unverified physical result and an unsupported product boundary.
`Unknown` is not a successful test. No physical operator record exists here:
physical device, OS, browser/version, served Studio/Core SHA, keyboard/IME and
transport/auth identities are all **unknown**. Do not fill those fields from a
headless host, a source commit or an owner-resume message.

| Area | Recorded synthetic/source observation (not rerun here) | Physical device status | Unsupported / limit |
| --- | --- | --- | --- |
| Connection / switching | Existing mock exact-target and first-run coverage; [published record](../first-release-verification.md) and [protocol evidence](protocol5-validation.md) retain their own target identities. | Unknown device/OS/browser/served pair; connection, reconnect, background resume and remote HTTPS not performed. | A mock transport is not a phone network, tailnet configuration or authentication proof. |
| IME / keyboard | Existing tests exercise selected application events; no real composition/candidate or virtual-keyboard trace is supplied by this task. | Japanese composition, commit/cancel, Enter, hardware keyboard and keyboard viewport not performed. | DOM-dispatched keys do not establish platform IME or safe-area behavior. |
| Scroll / selection | [C1](conversation-handoff-validation.md) retains proved text in its limited final subset. [T8](tool-publication-validation.md) gates tracked fresh nodes on exact refs. | Physical touch/fling, selection handles, clipboard and keyboard accessibility not performed. | General item bodies and arbitrary unreferenced legacy aggregates remain unsupported; a scroll correction must not hide missing text. |
| Return-to-tail | [Mobile follow investigation](mobile-follow-investigation.md) records a Chrome-emulation fling plus untrusted click failure; a CDP touch tap cancels the old fling in that recorded setup. | Physical behavior and original incident ordering unknown; not performed on a phone. | Private diagnostic provenance is not a public rerun or a universal navigation guarantee. |
| Auth display | Existing source/guide describes explicit opt-out separately from default authentication; no new mode is enabled here. | Authenticated/no-auth indicator visibility, keyboard overlap and navigation on a phone not performed. | #4 is a specification/dependency plan in this assignment, not authorization to implement or activate no-auth, Serve or Funnel. |
| Themes / logos | [#11 corrected evidence](theme-logo-validation.md#guarded-follow-up-evidence): 1280/390, three explicit themes, six runs of 47 RAF samples (282); measured errors/incorrect colors/replacements zero in that trace. | Device/browser/actual tab favicon pixels, cold paint, launcher/PWA and phone contrast unverified. | App Auto is not provided. OS-media SVG image observation is not actual browser-chrome favicon evidence; ICO/apple/PWA fallbacks are fixed, not adaptive. |

### Source And Artifact Attribution

The current source baseline is not the executed SHA of every historical trace.
C1's exact candidate and its author/independent limits stay in its linked record.
T8's accepted source repair is
`dd9372b338d0be0bae6bb475145d8131b23192da`; its legacy and positional
28-condition traces are author browser observations, not independent phone tests.
The #11 corrected candidate is
`05bcba665fc80d89e4837735a53dd275ac414111`; its predecessor's 288-sample
claim was withdrawn. The authoritative record gives exact old/new log hashes,
runner blobs, 282 samples and computed contrasts. Do not restore the withdrawn
numbers or add separate parent/author/independent test counts together.

The mobile-follow artifact record identifies product baseline
`c2a63261d6cc49be7ad084e3d2fdf28337c9bddb` and private diagnostic
provenance separately. It reports macOS arm64/headless Chrome and emulated
390x844, not a phone. Its exact Chrome version, physical device and phone OS are
**unknown** in that record. `$TMPDIR` artifact names are descriptions, not bundled
public evidence or permission to read real user data. This reconciliation reuses
the published descriptions without importing private commits or artifacts.

## #4 Dependency And Acceptance Plan Only

A future separately authorized no-auth follow-up must reconcile issue #4's exact
specification with the actual chosen source/served target and any existing
implementation. Existing guide text does not authorize a new implementation or
prove acceptance of the next target. Candidates for that future review are
HTTP/WebSocket Host/Origin rejection, unchanged default token/session behavior,
explicit opt-out warnings, always-visible narrow-layout auth state, and the
Serve-only/Funnel-prohibited access limits. Host/Origin is not user authentication;
other reachable processes or shared-tailnet clients remain an access risk.

Plan future isolated synthetic request/layout checks first. Physical connection,
IME, keyboard, scroll, selection and auth-strip results require a separately
authorized disposable setup, known served identities and a complete operator
record. Unknown Serve/Funnel topology must remain unknown; do not probe or change
it in this docs task. No new phone, owner, tailnet, authentication, implementation,
installation or runtime operation is authorized by this plan.

Mark a row PASS only for the specific device/browser/served identities actually
observed. Record failure or unsupported behavior without silently changing the
expected behavior, retrying until green, or substituting emulated evidence.
Physical Safari/Firefox, assistive technology, PWA installation, remote HTTPS and
upgrade behavior need their own explicit records; this short table does not
claim they are covered. Any future synthetic regression candidates remain
separate from the physical result column and do not close #10 by themselves.
