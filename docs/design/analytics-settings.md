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

**The owner has no read of `config.toml`.** No `Command` reads or writes it. `config check` and
`config init` are standalone CLI commands that `src/config_setup.rs` documents as "not owner RPCs":
`config check` reads the file and makes one catalog GET with the CLI's own environment, which may not be
what the running owner loaded. So these have no read and Settings says so: `default_connection`,
`default_model`, `default_effort`, `base_url`, `api_key_env`, `ssl_verify`, timeouts and retries,
all of `[shell]`, `[retention]`, `[limits]`, `[compaction]`, `[embedding]` and `[indexing]` values other
than what `index.status` and `thread.get` reflect.

Where such a key has a documented default, Settings shows it marked as a documented default that the file
may override. It is never presented as the running value.

Credentials: nothing in the bridge or browser reads a credential value. No owner read returns a credential
variable name either, so the name is listed as unavailable. `shell.env` values could hold secrets; only
names would ever be shown.

## Writes

Nothing in these views writes. `Changes take effect after owner restart` isn't shown, because no edit path
exists. The only related owner write is `thread.set` (per Thread: title, cwd, connection, model, effort,
`auto_compact_at`, `segment_chars`, `reduce_rounds`, applied at the next boundary with no restart). It stays
denied here; the Compaction section names it.

Options for editing `config.toml`, for the user to choose:

| Option | What it needs | Trade-off |
|---|---|---|
| A. Owner operations `config.get` (redacted: names, not values) and `config.set` | Core: two operations, atomic file write keeping comments, validation with the existing `Config::parse` | Recommended for reads at least. A general client surface, also usable by the CLI. Reports what the running owner loaded versus the file, which also makes the restart banner true |
| B. `config.get` only; the UI shows the file and how to change it | Core: one read | Smallest step; removes every "Owner doesn't report this" in Settings |
| C. Bridge reads or writes the file through the `shellboy::config` crate API | Bridge only | Breaks the rule that the bridge talks only to the owner's RPC. The file may differ from what the owner loaded, and the bridge's environment isn't the owner's, so credential presence would be wrong. Not recommended |
| D. Bridge runs `shellboy config check` | Bridge: a child process | Same mismatch as C, plus a network GET per read. Not recommended |

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
- A walk runs when Analytics opens, on a period change and on Refresh. Never per render, and there's no
  polling. Weights are applied locally with no read.
- Stop halts after the call on the wire. `cursor_expired` keeps partial values and asks for a new read.
- By-Thread is a second walk, on request only. Compaction events are one `compact.list` for one Thread.
- Resources are four finite reads when a view opens and on Refresh.

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
| Analytics is one scrolling page with Resources below | The questions are read together; a tab would hide the reads' state | The page proves too long in use |
| The popover keeps theme and language, and links to Settings > Appearance | Those choices are quick and were just fixed in the popover | The user prefers one place |
| Period is browser-local fixed offset, not `local` | Calendar days should match what the reader sees when the owner is elsewhere. Uncertain: a DST change inside the period shifts boundaries by the offset difference | Someone reads across a DST change |
| Settings reads one `thread.get` for the selected Thread, without opening its history | Opening a Thread walks its history (`data-layer.md`) | A Thread picker is wanted |
| Documented defaults are shown beside "Owner doesn't report this" | Useful to read, and marked so it isn't taken for the running value. Uncertain under the no-guessed-values rule | `config.get` exists; then they go away |
