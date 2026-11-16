# Accepted-window negative coverage to migrate into shared fixtures

- `owner-isolation.test.ts`: reject release after owner/session invalidation and reject mismatched scope.
- `window-attempt-atomic.test.ts`: preserve the prior accepted snapshot when a successor publication is rejected.
- `public-persistence-append-boundary.test.ts`: do not release the live record before the accepted saved-row successor is current.
- `terminal-presence-read.test.ts`: preserve missing-body, multiplicity, order, and long-text behavior without terminal proof state.
- `pending-invalidation.test.ts`: reject reentry after cancellation or epoch change.
