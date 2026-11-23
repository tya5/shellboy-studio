# Studio Checks

Chores runs `gh workflow run Checks --ref BRANCH` for review rounds. This runs
both Checks and exact-pair owner acceptance on Ubuntu only.

For the integration batch, use `gh workflow run Checks --ref land/batch -f all_oses=true`.
Verify the exact batch SHA and success of both jobs on each of the three OSes
before moving `main`. A Linux review run is not batch qualification. A main push
reuses a successful exact-SHA Checks run only if all six jobs actually passed;
otherwise it runs all three OSes. A skip-only run is not reusable evidence.

## Exact-pair owner binary cache (#119)

The owner job still checks the official source checkout against Studio's manifest
and lock on every run. It restores only the exact Core SHA, Rust target, toolchain,
runner and build-settings key, with no fallback. On a miss it builds the locked
release binary from that checkout. On both paths it verifies the cached or newly
built bytes against the build receipt before executing `--version`, then checks
that version against the verified package and runs the full integration suite.
The receipt is a hash check, not a signature; the executable cache relies on
GitHub's ref isolation. Only successful integrations on `main` or `land/batch`
in the official repo save entries. A batch entry can be reused by subsequent
batches on that same ref; review branches can use eligible default-branch entries.

Historical step timings from the existing run records (build and version check /
integration suite):

| Run | Ubuntu | Windows | macOS |
|---|---:|---:|---:|
| [45275011488](https://github.com/tya5/shellboy-studio/actions/runs/45275011488) | 6m 54s / 5s | 16m 30s / 23s | 23m 16s / 25s |
| [45279689684](https://github.com/tya5/shellboy-studio/actions/runs/45279689684) | 6m 23s / 4s | 17m 03s / 22s | 11m 11s / 19s |

Both runs predate binary caching. On a verified cache hit the build step is
skipped, but restore, verification and integration still take time. No existing
post-change hit record is available; no wall-clock savings are claimed and no
measurement run was dispatched.

## Candidate and release packaging

Packaging requires proof from `ci.yml` for its exact Studio commit, not just a
successful Checks badge. The guard checks the official Core revision in that
commit's manifest and lock, then requires one completed successful attempt with
all three Checks and all three owner jobs, including each owner's Core pin
verification and integration suite. Candidates require a dispatched Checks run;
release tags may also use qualifying main-push Checks. A missing, skipped, or
unfinished proof stops packaging. Checks still runs the owner suite; candidate
and release workflows do not run a second copy. Release builds and the draft
verify the exact tag commit; the desktop jobs still verify the official Core
source and, for release ZIPs, the published stable Core tag.

CLI and desktop packaging use dependency caches scoped by OS, target, Rust
version, build mode, lock and Core revision. The frontend and locked Cargo
commands run on both hits and misses; the cache is not a candidate artifact.
To promote tested candidate bytes, preserve and verify those exact archives
and their provenance. Rebuilding for a draft is not promotion of a candidate.

### #26 baseline (existing run records, no new dispatch)

Both runs used Studio `d32de25bc072fb71505acc1fe9d9e2cd9d6c8df7`.

- [45180070906](https://github.com/tya5/shellboy-studio/actions/runs/45180070906): the guard failed in 4s and packaging was skipped. There are no build or cache measurements in this run.
- [45199779709](https://github.com/tya5/shellboy-studio/actions/runs/45199779709): the guard passed in 4s, then the duplicate Ubuntu owner job took 8m 09s (Rust cache hit; Core release compilation still took 7m 20s). The macOS arm64 CLI Cargo cache missed and its release compilation took 5m 48s. The macOS desktop build had no Cargo cache; its Studio and Core release compiles took 10m 24s and 19m 23s. Windows and Linux CLI caches also missed (release compiles 5m 43s and 5m 24s). Overall elapsed time was 44m 06s; the last job was the macOS desktop app (30m 44s, after the owner gate and runner wait).

The new DAG removes the measured duplicate gate, not the compile jobs.
Those runs predate this workflow change: they do not measure wall-clock
savings or warm-cache performance on the new cache keys.
