# Studio #19: generic remote-access copy

Base: b3a555f143b86400f6f3dd23fe867f7ab90dca06.
Scope: copy, localization and synthetic tests only. Authentication, transport,
Host/Origin checking and runtime control flow are unchanged.

Red-first copy/i18n/auth-mode tests: 5 failed, 7 passed before copy changes.
Afterward: frontend typecheck and 60 files / 1248 tests passed, frontend build
passed, owner-free release preparation 22 passed, Rust format and two CLI
no-auth/help tests passed. These are author checks, not independent review.

## Chrome

Use the existing installed Chrome, not a browser download or real owner:

```sh
cd web
./node_modules/.bin/vite --config designs/console/test/browser/remote-copy-vite.config.mjs --host 127.0.0.1 --port 19692 --strictPort
# In another shell, from the repository root:
node web/designs/console/test/browser/remote-copy-check.mjs
```

Synthetic settings model + fake auth-mode bootstrap, actual console components
and styles. Eight cases: English/Japanese, authentication on/off, widths 1280
and 390. All passed: generic HTTPS/VPN/HOSTNAME/--no-auth copy, no tailnet/Serve
dependency, warning only when explicitly off, and no horizontal page overflow.
This is desktop Chrome viewport emulation, not a physical phone, Safari, actual
proxy/VPN, Serve/Funnel operation or real authentication/owner acceptance.

The first generic browser harness attempt failed before rendering because its
dev-server dependency optimization loaded separate Preact hook/render copies.
The dedicated test config uses explicit shared dependencies; no product code
was changed for that harness correction. Its failed run is not success evidence.
The successful run exited zero with eight explicit case records. Task-owned
Chrome and Vite were stopped; no existing owner or browser profile was touched.

The three localization keys remain English/Japanese paired. Tailscale Serve is
retained as a labeled User Guide example, not required setup. No-auth warnings
continue to forbid public exposure, including Funnel, and state that VPN access
is not user authentication. Shared #15/#18 keys and settings rows are preserved.
CI, independent exact-source/privacy approval and fresh-main ancestry remain
separate gates before publishing this candidate branch.
