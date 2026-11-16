# Publication Refresh Liveness

The bounded unit uses `readyTarget` and the public Window `changed()` refresh
API. It first runs `prepareBoundReadyRead` and `pump`, then observes the exact
attempt retired and the handoff empty. It then performs the normal Window
refresh and observes public output: row order `[0, 1]`, one canonical answer
with the same presentation container and saved body, the retired attempt still
present, canonical ownership still present, and no preview entry reappearing.

This is a real ready-admission -> retirement -> Window refresh transition, not
the earlier `target()` declared-cut composition test. The fixture's refresh
source returns the existing selected history; it does not claim a changed
server revision. Existing lease/currentness and revoked-owner negatives remain.
No production defect is established and no text deduplication, forced-ready,
scroll, cache, registry, or retry path is introduced.
