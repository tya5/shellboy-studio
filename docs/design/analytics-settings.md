# Analytics and Settings

Status: implemented (2026-11-07), local only. Established from Shellboy at tag `v0.10.0`
(`91be730e89`) by reading `src/protocol.rs`, `src/usage_totals/breakdown.rs`, `src/gc.rs`,
`src/control/memory.rs`, `src/readback/compact.rs` and `src/config_setup.rs`, and by calling a real
`shellboy serve` of that version on a temporary data directory.

Logic is in `web/ui-core/src/analytics.ts`, `resources.ts` and `insights.ts`; screens in
`web/designs/console/screens/Analytics.tsx`, `Resources.tsx` and `SettingsView.tsx`.

## What the owner can answer

| Question | Read | Notes |
|---|---|---|
| Daily tokens, cache, summary use, compaction count | `usage.get group_by=day` | Period at most 31 days, days bucketed by `local`, `UTC` or a fixed offset. See "The walk" |
| Same, per Thread | `usage.get group_by=thread` | A second walk, so on request |
| Compaction events and their effect | `compact.list` with one `thread_id` | Up to 200 rows; `trigger.input_tokens` only on automatic events; `post_compaction_input_tokens` is read from saved attempts. There is no list across Threads |
| Owner memory and cache budgets | `status {memory:true}` | Limits are the configured `[cache]` values. On `shellboy serve` the body and layout caches report "UI cache owner is not available" |
| Storage | `storage.status` | Logical bytes by category, DB/WAL/log/managed file sizes, reclaimable (lower bound), free disk when known, `warning`, `limit_reached`. It does **not** return the warning or maximum sizes |
| Index | `index.status` | `auto_history`, counts, paused, reason, spaces with connection, model, dimension, segments and vector bytes |
| Receipt budget | `status` `receipt_budget` | Used and limit bytes, retention seconds |
| A Thread's settings | `thread.get` | connection, model, effort, cwd, agents path, own and effective `auto_compact_at`, `segment_chars`, `reduce_rounds` |
| A connection's catalog | `model.list` | One GET to the provider's model list, so it runs only on a press |

**v0.10.0 has no read of `config.toml`.** No `Command` there reads or writes it. `config check` and
`config init` are standalone CLI commands that `src/config_setup.rs` documents as "not owner RPCs":
`config check` reads the file and makes one catalog GET with the CLI's own environment, which may not be
what the running owner loaded. So these have no read and Settings says so: `default_connection`,
`default_model`, `default_effort`, `base_url`, `api_key_env`, `ssl_verify`, timeouts and retries,
all of `[shell]`, `[retention]`, `[limits]`, `[compaction]`, `[embedding]` and `[indexing]` values other
than what `index.status` and `thread.get` reflect.

Settings shows these rows as "Owner doesn't report this", with no default beside them (user decision
2026-11-07, under the no-guessed-values rule). An owner with `config.get` and `config.set` fills them (below): each row carries its public TOML key (`ConfigKey`), and `Fact.control` takes the edit control.

Credentials: nothing in the bridge or browser reads a credential value. No owner read returns a credential
variable name either, so the name is listed as unavailable. `shell.env` values could hold secrets; only
names would ever be shown.

## Writes

Nothing in these views writes. `Changes take effect after owner restart` isn't shown, because no edit path
exists. The only related owner write is `thread.set` (per Thread: title, cwd, connection, model, effort,
`auto_compact_at`, `segment_chars`, `reduce_rounds`, applied at the next boundary with no restart). It stays
denied here; the Compaction section names it.

## Editing `config.toml` (#266)

`config.get` and `config.set` landed on Shellboy main (`cccb713f`), not in v0.10.0, so editing sits behind the capability `config.edit`, which says what this bridge was built to send (`seam::owner_capabilities`, feature `next-shellboy`; see `branches-threads.md`). A normal build pinned to v0.10.0 says editing isn't available and why, makes no `config.get`, draws no control, and the bridge refuses both: the protocol it was built against has no such commands. The file rows keep saying "Owner doesn't report this", which there is true.

With the capability, opening a Settings section reads `config.get`, and leaving Settings cancels that read. `ConfigEditor` (`ui-core/src/config.ts`) holds the drafts, so they survive a change of section.

| Rule | How |
|---|---|
| Only what the person changed is sent | Drafts are per field. A draft equal to the file's value is dropped |
| `[redacted]` is never posted | A hidden value has no text control, only "Set, hidden", Replace and Remove. Typing the placeholder makes a draft invalid, which blocks the review, and `save()` refuses again. The owner refuses it too (`redacted_placeholder_refused`) |
| Replacement values stay out of sight | Password fields, and the review and result say "New value, hidden". Drafts are in memory only, and a written one is dropped |
| Credential fields are names | `api_key_env` is a variable name, with whether the owner's environment has it (`credential_env_set`). A credential typed there is the owner's refusal, shown |
| Entry whose name looks like a credential | Shown as the owner hides it, with no actions, since `config.set` refuses a field containing the placeholder. The person edits the file |
| Typed controls | Bool and choice as button groups, whole numbers parsed here, and blank removes the key so the default applies. Bounds stay with the owner, which validates |
| Diff first | Nothing is sent until Review, then Write to file. Before and after are from the file, and the result shows what the owner reports changed: effective values, which may differ from the request |
| Stale file | `expected_hash` is the hash of the last read. `operation_conflict` reads again, keeps the drafts and says so; the next write uses the new hash, so another program's edit isn't overwritten silently |
| Refusals | The owner's own words, with the field from `change_index`, and `recovery_file` when a replace was interrupted. `warning` on a result is shown |
| Restart | `restart.all_fields_require_restart` is all there is, so one line says it on every section. `differs` and `differing_fields` show what's waiting, and a row shows the value the running owner still uses. The UI can't restart the owner: `owner.shutdown` stays denied |
| No reply | The file is read again. A visible draft the file now agrees with is dropped. A hidden one can't be compared, so it stays and the notice says so; writing it again is refused if the file changed |
| Invalid file | Its validation message, and what the owner loaded, read-only |

Left out: adding or removing a connection, and fields beyond the rows Settings already had plus the connection's name fields, effort, TLS, timeouts, retries and hidden entries. `config.set` can do more; those are the file's for now. Apps can't reach either command: `apps.call` has its own list.


## The walk

`usage.get` in grouped mode scans `model_attempt` by rowid from the first attempt ever saved, at most 10,000
per call, and filters by time afterwards; the summary records in `app_meta` have an independent 10,000-row
window. There is no way to start at a date. A period's cost therefore grows with the whole history, not with
the period. Measured for sizing only, on the user's real database with `mode=ro` (no contents, no owner
call, 2026-11-07): 70,495 attempts and an `app_meta` maximum rowid of 247,171, which is about 25 calls to
finish one walk. Time per call on that database wasn't measured, because no call was made to the real owner.

Bounds, all in `insights.ts`:

- One call on the wire per walk, each waiting for the last reply.
- `MAX_WINDOWS` = 64 per run. It then stops, keeps what it has and offers Continue from the same cursor.
- A walk runs when a section that shows it opens, and again for a new period or on Refresh only if such a
  section is open. Never per render, and there's no polling. Weights are applied locally with no read.
- Stop halts after the call on the wire. `cursor_expired` keeps partial values and asks for a new read.
- By-Thread is a second walk, read when By Thread opens. Compaction events are one `compact.list` for one Thread.
- Each resource read runs when a section showing it opens and on Refresh. Switching sections drops nothing:
  walks live in `Insights`, not in the pane, and carry on while another section is shown.

Sections (`#/analytics/<section>`): Overview, Tokens and Compaction use the daily walk; By Thread its own walk;
Storage reads `storage.status` and `status`; Memory `status --memory`; Index `index.status`. Settings sections read
the same way: `thread.get` for four of them, `index.status` for Embeddings, storage, memory and receipts for Storage.

The same day can recur across windows. Counters add. Percentiles and ratios don't, so the cache rate comes from
summed `cached_tokens / input_tokens`, the mean input is re-derived from `known_count` and `mean`, and p50/p95
aren't shown. Conversation sums take the terminal states only (`completed`, `failed`, `incomplete`), because
other states carry no usage and would read as unknown.

## What isn't shown, and what core would need

| Missing | Why | Core need |
|---|---|---|
| Daily tokens **by model** | Grouped usage keys are `hour`, `day`, `thread`. `connection_rates.by_connection` holds only 429/5xx and wait counts. A Thread's current model isn't the model of its past attempts, so deriving it would be a guess | `group_by=model` or a second key (`day,model`), with the same sums |
| Reading a period cheaply | No start at a date | A plain `started_at` index and a seek (the design in `usage-aggregates.md` already allows proposing it with measurements) |
| Storage warning and maximum sizes, so a meter is possible | `storage.status` returns only `warning` and `limit_reached` | Add `warning_bytes` and `limit_bytes` to `storage.status` |
| Largest Threads by storage | `thread.delete_preview` answers one Thread at a time | A bounded `storage.by_thread` or a `limit`ed list |
| Preview for `storage.collect` | `StorageArgs` has only `category`; there is no dry run. So collection isn't offered | `storage.collect {dry_run:true}` reporting what would go |
| Deleting an index | Waits for Shellboy #253's explicit command; recreating costs money, and the UI says so | #253 |
| Compaction events across Threads | `compact.list` is per Thread | A bounded list without `thread_id` |
| `storage vacuum` | Needs the owner stopped, so the page explains it and offers nothing | None; by design |

## Effective tokens

`uncached + cached x n + output x m`, defaults `n = 0.1`, `m = 5`, kept per browser in the preferences. The
page states that these aren't prices. No price is known, so no money is ever computed. `uncached` is
`input - cached`; if a provider reports more cached than input the split isn't drawn and isn't clamped. A value
the owner doesn't report stays absent: no bar, "No value" in the table. Days with some unknown records are
marked as lower bounds.

## Charts

Inline SVG in the system's `Chart` component, no chart library: the marks are simple, one library would be
the largest thing in the bundle, and every number comes from one scale function. Text is drawn at true size
because the SVG is laid out at the frame's measured width. The three series hues passed the dataviz
validator on `panel` for all pairs (dark `#3987e5,#199e70,#d95926` on `#0e1827` and `#0a0a0a`; light
`#2a78d6,#16976a,#eb6834` on `#ffffff`, where its CVD pair is in the 6-to-8 band, so the stack's gaps,
legend and table provide the required second channel). Single series use `muted`.

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Analytics is split into sections by a shared SubView (user request 2026-11-07), replacing one long scroll | The page was too long; panes also make reads lazy | — |
| Phone tabs are Awaiting you, Conversation, Monitor and More (user request 2026-11-07) | Five tabs were tight; More holds everything else | — |
| At phone width tables stack into label and value pairs, except a chart's value table | No hidden column and no sideways scroll | — |
| The popover keeps theme and language, and links to Settings > Appearance | Those choices are quick and were just fixed in the popover | The user prefers one place |
| Period is browser-local fixed offset, not `local` | Calendar days should match what the reader sees when the owner is elsewhere. Uncertain: a DST change inside the period shifts boundaries by the offset difference | Someone reads across a DST change |
| Settings reads one `thread.get` for the selected Thread, without opening its history | Opening a Thread walks its history (`data-layer.md`) | A Thread picker is wanted |

## Validation record (2026-11-07)

Environment: macOS (Darwin 25.3, arm64), Node 25.9, headless Google Chrome driven over its DevTools protocol by a throwaway script, bridge debug build embedding the production bundle, `~/.local/bin/shellboy` 0.10.0 `serve` with a temporary HOME and data directory and a local mock Responses endpoint. No paid request. The user's data directory wasn't connected to; its database was opened once with `mode=ro` for row counts only.

The data was synthetic: mock replies, then, with the owner stopped, attempts copied to 33,959 rows and their times moved across 13 days directly in the temporary database, to exercise days and scan windows. Row sizes don't match real ones, so these timings say nothing about the real database: a walk of 4 windows reported 204 to 273 ms of owner time.

Commands: `npm run check` (typecheck and Vitest), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` with `SHELLBOY_BIN` set to the same 0.10.0 binary. `tests/real_owner.rs` now sends every new read through the bridge to that real owner, and checks that `storage.collect` is refused.

Seen in the browser against the real bridge and owner: every Analytics section; all charts, tables and Resources; Console, Light and Terminal at 1440 px and 390 px; Japanese; hover tooltips; opening a chart's table; period change; weights changing the figures with no read, kept per browser, an invalid value refused; by-Thread walk and choosing a Thread's compaction; the range bar with a real "after" value; a walk over 4 windows with real cursors; Stop then Continue; owner down and then back, which read again by itself; the catalog on a press. No console error, no request leaving the bridge's origin, no horizontal page overflow. Daily values for six days were compared with a direct SQL sum of the temporary database and matched.

Browser device emulation is not a phone test. Not tested: real phones, Safari, Firefox, Windows, Linux, a real provider, the user's real data, index spaces in a browser (the temporary owner had no embedding configured, so spaces are covered by fixtures only), storage `warning` or `limit_reached` in a browser (fixtures only by logic), the 64-window bound against a real owner (unit test only), a screen reader.
