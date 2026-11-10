# Read-Only Handoff Retry State

Scope: client state/action feedback only; no send, run retry, model/tool execution,
new RPC, polling, or installed runtime work. Actual user Thread cause is unknown.

| Phase | Reason | canRetry | Entry / action | Control |
| --- | --- | --- | --- | --- |
| idle | absent | false | Initial/normal confirmation or proven terminal persistence | initial / terminal |
| idle | no-pending | false | No confirming/failed owned records | no targets |
| reading | absent | false | A real bounded status lookup has started | held read |
| failed | lookup-failed | true | Non-cancelled lookup failure | lookup error then retry |
| unavailable | unresolved | true | Read completed but no qualifying persistence/complete handoff | absent/nonterminal result |
| unavailable | budget-exhausted | true | Existing eight-start budget consumed | repeated hints bounded |
| unavailable | closed | false | Owned handle closed | closed retry sends zero |
| unavailable | paused | false | Entry paused | paused retry sends zero |
| unavailable | owner-unavailable | false | Public owner is not connected | owner unavailable sends zero |

Explicit retry has always replenished the existing eight starts and invalidated the
old read epoch (`HandoffStore.reconcile`). This repair documents rather than widens
that behavior. Hints never replenish it. Lookup concurrency remains one, refs <=64.
Busy clicks coalesce into the existing single resolveAgain flag. The returned
Promise must await that one queued continuation, not just the superseded lookup.
Normal confirming alone is not a failure and must not be labelled a retry error.

After every newly introduced reactive state write, recheck original scope/epoch/
Cancel qualification before a read or later authority-bearing operation. Invalid
requests report an honest disabled state; no fake spinner for a read not started.
D owns button visibility, disabled labels and render feedback; this state is not
an admission capability and must never revive a stale snapshot/handle authority.

Controls preserve original known reds, and distinguish new absent-state API reds
from the independent old early-Promise-settlement counterexample.
