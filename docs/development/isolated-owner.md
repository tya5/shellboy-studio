# Isolated Core/Studio development (#101)

Build Studio with the embedded frontend and use a Core executable built from
Studio's exact manifest/lock pin. Run with a fresh browser profile:

```sh
python3 tools/isolated-owner.py --core /absolute/path/to/shellboy --studio /absolute/path/to/shellboy-studio
```

Open only the printed loopback URL. The token is disposable but should not go in
shared logs. Add `--check` for startup/HTTP health only, without printing the token.
Do not send to a model: the fixture config is credential-free with a loopback
placeholder. Ctrl-C stops both children and removes the scratch directory. The
runner creates the Core config and data, Studio auth, and platform home/runtime
paths; it takes no overrides for those paths or the listener. The owner must
report the owned data directory and publish its instance in that directory before
Studio starts. No inherited owner environment or token is passed to either child.

## Audit at Studio base `932690676`

- `web/vite.config.ts:42` proxied `/ws` and `/auth` to the ordinary Studio port
  8751, allowing arbitrary pre-existing bridge state into dev. Removed the proxy;
  Vite is frontend-only. Use the isolated pair for live web/visual testing.
- `src/main.rs:254`, `src/main.rs:263`: ordinary Studio resolves owner data and
  token paths when omitted. Supplying an explicit data dir previously did not
  exclude Core's inherited socket when `SHELLBOY_DATA_DIR` matched it. The CLI
  now refuses that combination before installing a guide or probing an owner.
  Ordinary no-argument product defaults, token commands, and the desktop launcher
  (`src/launcher/desktop.rs:536`) are product entry points, not test recipes.
- `tests/real_owner.rs:38` already spawned an explicit scratch Core with a clean
  environment. `tests/real_owner.rs:96` inherited the parent environment on
  shutdown, and `tests/real_owner.rs:147` and the other `IpcOwner::new` call sites
  dial from the test process itself. Startup and shutdown now share the sanitized
  cwd/env and explicit config/data; before dialing, the harness rejects a matching
  inherited data dir and checks Core's reported data dir. The [exact-owner workflow](../../.github/workflows/exact-owner.yml)
  supplies the pinned Core binary, not a long-lived owner. Bridge/app/event tests use
  in-process synthetic owners (`tests/common/mod.rs`); protocol tests use values only.
- Browser checks that navigate to `/` could initially load ordinary Studio when
  supplied its port: `web/designs/console/test/browser/production-check.mjs:21`,
  `web/designs/console/test/browser/brand-check.mjs:22`,
  `web/designs/console/test/browser/logo-frame-check.mjs:23`, and
  `web/designs/console/test/browser/no-auth-check.mjs:19`. They now require the
  expected synthetic server marker before opening a browser, and reject port
  8751 without probing it. The other browser drivers open named fixture HTML
  routes, not Studio's `/` (`src/server.rs:94`); both fixture Vite configs have
  no bridge proxy. Owner-free visual and unit checks remain owner-free.

## November 19 procedure

The November 19 Core/Studio isolated-morning procedure created its scratch root
with `mktemp -d /tmp/shellboy-morning.XXXXXXXX`, seeded `$TRIAL/visual/data`,
and used that data directory for both binaries. Its unattended smoke driver
passed the following environment to Studio even with explicit `--data-dir` and
`--config-dir`:

```python
env = os.environ.copy()
env["XDG_RUNTIME_DIR"] = str(runtime)
env["SHELLBOY_DATA_DIR"] = str(data)
```

The copied environment retained any `SHELLBOY_SOCKET` and `SHELLBOY_INSTANCE_ID`.
Core v0.13.0 `src/ipc.rs` uses those variables when the inherited data directory
compares equal as a path to the requested directory; a trailing slash does not
make the paths distinct. Provenance: `core-studio-isolated-morning-handoff-20261119.md`
and `core-studio-morning-smoke-driver.py`.

That combination can advertise the fixture path in Studio's Hello while dialing a
different owner. `web/app/main.ts:151` automatically registers the advertised
path after the browser observes a connected owner with config editing; the writer
is `web/ui-core/src/guide-registration.ts` (`config.set` on `extra_instructions`).

This identifies the path-generating procedure and the misrouting mechanism. The
original headless driver did not run the browser guide effect itself; the five
individual browser writes were not replayed or attributed to particular attempts.
The later identity-checked diagnostic driver is not evidence of a real-owner
write. Retire the historical scratch recipes in favor of the repository tool.
This work does not inspect or repair any real owner config or database.
