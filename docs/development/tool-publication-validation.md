# Studio #8: Tracked Tool Publication Repair Candidate

Task base: public f70afc2869121ce34083d9f06653ed0e687b5c0a. Dedicated
studio-tool-publication-f70-s5 product branch, separate from the preserved two
7b6c diagnostic commits. No private ancestor/cherry-pick, Core API, #290 body
readback, RPC command, dependency/pin, scroll/anchor/debounce or runtime asset
change. Existing public status/response_nodes/history operations only.

## Supported Scope

After the first committed history baseline, track new assistant nodes before
publishing Message prose. Explicit older paging is legacy, not fresh generation.
A known exact tool ref also qualifies an initial row. Both legacy and positional
read boundaries apply the gate. Function-call and mixed nodes display only tool
identity, without aggregate text or fabricated command/state/success. Missing,
error, partial/truncated/ambiguous attribution stays checking/failed with explicit
retry. Already-proved live text is unchanged; unsupported aggregate does not
replace it. Normal explicit final-message JSON retains Message rendering.

Relevant message qualification is deliberately narrower than kind=message:
terminal exact Thread/attempt/Turn/node, complete non-cursor status observation,
complete well-formed refs, unique output ordinals, no competing attempt, one
relevant explicit final_answer message. A node's output refs are not body spans.
Commentary/multiple message/mixed aggregate bodies are not split into invented
items; the independent C1 final-only projection remains available where proved.

Incoming client-only qualifications are stripped. Local proof metadata travels
with existing bounded retained rows; positional proof map <=8, publication
candidate map <=8. C1 shares total eight candidate/attachment admission and
per-explicit-generation eight additional RPC starts, one admitted lookup.
No hint refill or polling; explicit retry may change candidate priority without
evicting safe text. Preview body accounting remains C1 one MiB UTF-8.

## Red To Green

Preserved diagnostic 7b6c: six DOM acceptance failures plus one message JSON
control; 28 actual Chrome conditions, 440 RAF samples, 24 problematic cases with
360 raw-bearing viewport-intersecting samples. Four ordinary-message controls
contain a separate 52 raw samples. This is synthetic aggregate observation, not
proof of provider payload item spans.

The same seven DOM cases now pass. The same 28 width/theme/scenario runs now show
zero raw `.msg` samples in all 24 problematic traces; all four ordinary message
controls remain visible. Extra positional-history 28 conditions use the same
scenarios and assertions. An intermediate positional test exposed a new defect:
owner ABA lost history.window capability and re-entered initial legacy fallback,
showing raw aggregate in four cases. Retaining the local publication safety
watermark across owner/capability changes fixes that path without retaining old
classification authority. Both legacy and positional runs are repeated on the
candidate; their logs are author evidence, not independent review.

Data regressions cover synchronous first publication, malformed/truncated/cursor
refs, competing attribution, commentary/null unknown, shared read-budget
exhaustion/no hint refill/retry, legacy older paging, initial known refs,
positional new-node gating, actual outstanding status cancel/pause/close and ABA.
The actual cancellation test withholds the original status response then returns
only that old response after teardown; it does not mistake a new generation's
legitimate lookup result for a late-reply failure. Subscriber-cancel and forged
wire qualification cases are also included. The original browser owner-ABA
exposure trace remains separate from these actual asynchronous cancellation tests.

Existing smoke tests that assumed any newest saved aggregate was an answer now
assert retained proven live text plus unknown status instead. Branch marks are
kept on placeholder rows; existing unrelated history is not hidden. All full-web
counts and browser counts are recorded with the submitted exact candidate.

## Commands / Environment / Limits

Owner-free macOS, FakeTransport/fixture database, existing installed Chrome.
`cd web && npm run check` (both TS configurations and Vitest), `npm run build`.
Task Vite: `npx vite --config designs/console/test/browser/vite.config.mjs
--host 127.0.0.1 --port 19612 --strictPort`.
Browser from repository root:
`FIXTURE_PORT=19612 DEBUG_PORT=19623 node web/designs/console/test/browser/tool-json-check.mjs`.
Use `WINDOWED=1` with a different unused DEBUG_PORT for positional mode; do not
share a running Chrome debug port between tests. One attempted overlapping run
failed before observations on an occupied target and is excluded, not a green.

Each RAF counts matching ordinary Message elements and viewport-intersecting
rects; no JSON viewer/details button is opened. Samples are bounded <=128 per
condition. Font/mount readiness is awaited. Device emulation is not phone/touch
acceptance, DOM/layout samples are not raster/privacy proof, and no whole-time
or actual owner/provider/CSP/cross-OS guarantee follows. Additional unknown rows
may require explicit retry when the shared budget is exhausted or another read
owns the single slot. No broad hide-all-legacy policy is introduced.

Arbitrary unreferenced legacy aggregates remain contract-unsupported. This
candidate does not make all historical assistant bodies safe, implement general
item readback, adopt Core #290, or complete Core #285 notification work. It does
not infer sender identity from notices. Independent S6/privacy review, combined
ref audit, publication, CI and runtime adoption are separate gates. Task-owned
Vite/Chrome must be stopped after validation; no real owner/data/API/paid provider.

Author checkpoint: 1217 tests / 58 files, both TS configurations and web build
pass. Focused data publication regressions: 20 pass; seven DOM boundary/control
cases pass. Final legacy 28 runs and positional 28 runs each capture 440 RAF
samples: raw-bearing samples in the 24 problematic cases are 0, while four normal
message JSON controls remain visible for 52 samples per mode. These author counts
are not independent review. Retained qualifications are explicitly invalidated
to unknown on owner/session teardown; a separately tested old pending reply
cannot restore them.

A final selected-Thread check exposed five pre-existing test-fixture mismatches:
WindowOwner answered every Thread as literal `t`, even when the model requested
lead/recover. The synthetic owner now echoes the requested Thread ID (retaining
`t` only for direct threadless unit reads). The product check is not weakened;
these fixture failures are not represented as an unmodified final green.

## Incomplete Competing Scope Follow-Up

Independent review held the first candidate: a complete matching final-message
attempt was incorrectly accepted when another same-scope attempt had truncated
empty refs. That second row might hide competing attribution. The repair fails
closed unless every observed relevant Thread attempt has valid identity and a
complete, well-formed, bounded ref list; missing Thread scope is unknown, not
excluded. An explicit different Thread is outside this scope. The shared scope
validator protects legacy and positional publication and
the separate C1 final-only body path; C1 is not an aggregate item-span proof.
Ongoing attempts also keep negative exclusivity unproved. Positive exact tool
identity remains available independently of negative message exclusivity.
Inventory cases cover truncated, absent/null, malformed, invalid
refs, ongoing attempts and missing/different Turn scope. The first five-case
replay had three failures before repair (two already failed closed).
No broader raw aggregate fallback or legacy hiding is introduced.

Positive exact tool identity is separate from negative message/body exclusivity:
incomplete other attempts do not make the aggregate safe, but need not erase an
otherwise proved tool identity. The same complete-scope helper now guards the C1
final body path, so its different body projection is not a competing-attribution
escape hatch. Ordinary-message controls with a complete empty other attempt or
an explicitly different Thread still pass; unknown/different Turn coverage in
the same Thread fails closed when incomplete. No additional page walk or RPC
budget is introduced. Initial five-case red replay was 3 failures/22 passes;
expanded final checks include nine bad-scope variants and three C1 cases.

A repeated positional browser run found a message control remained unknown when
the one lookup slot was occupied. This is not a raw leak; unknown/no-auto-poll is
the bounded admission policy. The message control may now exercise an explicit
retry if needed (recorded as its own sample phase), rather than asserting an
unconditional immediate-admission guarantee. Such a run is not identical to the
original 440-sample trace and its actual sample count is reported separately.

Follow-up final author check: 1231 tests / 58 files, both TS configurations and
build pass. Browser repeat completes legacy 28 and positional 28 conditions;
actual sample totals and any explicit-control-retry samples are kept in the
follow-up logs, not silently relabelled the original candidate's trace. No
independent/browser/native acceptance is implied by these author reruns.
