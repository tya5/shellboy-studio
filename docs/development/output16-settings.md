# #16 Maximum Output Tokens: Settings Reconciliation

The current Core 0.13 reconciliation is documented at the end of this file.
The original candidate description and evidence below are historical.

This separate lane adds the existing `connections.<name>.max_tokens` field to the
Connections settings rows for all three API formats. Production changes are one
integer field specification, a label and explanatory text. Blank remains unset;
configured values come from config.get, not an inferred model/provider default.
The existing config.edit permission, draft/review/save, hash, integer parsing and
owner validation paths are reused. No request mapping, default, extra_body,
receipt, partial output, retry or automatic save behavior is changed.

Source reference: Core request/config candidate
`3faf6edb964e853df92eb5188168bad16da1e19e` maps the connection value to native
fields for each API. It is not a claim that its collision policy or runtime is
published. The explanation says Claude may produce shorter output when omitted
and recommends Anthropic Messages, without diagnosing every short response.

Typed terminal output-limit presentation is deliberately excluded. Core candidate
`f0ffad29b3a3557c7079800eb47b7cd5018925f3` has a prospective typed error kind,
but its public path must be confirmed before Studio uses it. No string parsing
or metadata guessing substitutes for that contract.

## Author Evidence And Remaining Gates

On parent `2dee5539e689f661e495e98c96b328915856c42a`, the three API UI tests first
failed because Maximum output tokens had zero controls instead of two. Initial
fixture DOM-environment errors were corrected and are not product red evidence.
After the minimal change, seven focused tests pass: three UI value cases, three
save/reopen/unset cases and an integer/owner-error retention case. Existing config
and read-only settings tests remain part of the full suite.

Controlled FakeTransport Chrome tests cover 1280 desktop and 390 mobile emulation
for each API: blank -> explicit 4096 save -> reopen 4096 -> blank/unset save, with
only the changed max_tokens field written, no automatic write, unrelated extra_body
retained and no horizontal overflow. This is not a physical phone or real provider
check. The first browser attempt lacked the Preact JSX test-server configuration;
that environment failure is retained separately, not counted as a product failure.

Independent S6/source/privacy, same-SHA browser confirmation and all-OS CI remain
separate gates. The release lane and installed owner/binaries are untouched.

No queue, timer or asynchronous production path is added. Test browser commands
run a finite six-case matrix, own one temporary Chrome process and close it in
finally. The fixture owns only synthetic values and existing bounded transport;
its loopback Vite process is stopped after the run. No paid API or user data is used.

## Current Core 0.13 Reconciliation

The candidate evidence above is historical, not acceptance of this current
implementation. The current port reuses immutable commit
`6b60dfa29815b1440915d4c30c645e1471cc1372` on the published Studio line.
The prior author's worktree is not an implementation target.

Core 0.13's `thread.get` reports nullable `max_tokens` and optional
`effective_max_tokens`. The Thread dialog and settings readback both use the
same typed `readThreadSettings` projection. The override is blank when absent;
the effective placeholder comes only from the owner, never a provider/model
lookup or a guessed default. Changed values alone become `thread.set`
`max_tokens` strings, including the explicit empty string to clear. Errors leave
the draft available and do not turn observed settings into optimistic values.
Capability absence disables editing and issues no `thread.set`.

The Core contract gives Thread override precedence over connection `max_tokens`;
Messages uses 32768 only if both are unset, whereas Responses and Chat Completions
omit the Shellboy-owned limit. Summary length is independent. Core remains the
authority for positive integer limits, native `extra_body` collisions and
connection-switch validation. Studio adds no alias, fallback, inferred model
limit, automatic request retry or output-limit diagnosis.

Issue 303 retired Thread `segment_chars`/`reduce_rounds` and global segment,
rounds and map/reduce request-budget keys. They are removed from the typed
readback, editing model, operations, controls, translations and config-key table,
not merely hidden. Remaining historical split-part history rendering is not a
current settings editor and is unchanged.

Current regression coverage uses synthetic owners: all three connection API
modes, configured/unset readback, save/reopen/clear, unchanged-key omission,
owner refusal, actual Thread dialog and capability gating. Baseline REDs and
current validation results are recorded separately from old candidate evidence.
No provider, connected owner, private settings, installation or UI acceptance
is exercised by these tests.
