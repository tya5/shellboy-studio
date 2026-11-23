# PairingQr

- **Use for:** Display a locally generated short-lived pairing URL as a QR and readable text.
- **Do not use for:** Don't encode long-lived credentials; use the normal Settings connection controls for persistent configuration.
- **Why:** Black on white and a four-module quiet zone preserve scanner contrast across themes.
- **Source:** [Studio one-time phone pairing](../../../../../../docs/design/phone-pairing.md)

Use for a locally generated short-lived pairing URL. Fixed black modules on white preserve scanner contrast across themes; the quiet zone is four modules. The URL display and wrapping rule live with the QR. Do not use it for long-lived credentials.

Styles are colocated in `system/components/PairingQr/style.css`.

Styles: style.css in this directory
