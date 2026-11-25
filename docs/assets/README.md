# README Screenshot

`studio-reply-duties.png` is a development-build capture using invented Threads and messages, not a user's session. Keep this one light-theme PNG at 1x scale and no more than 250 KiB. A light image with its own opaque background remains readable against either GitHub theme.

Capture source: Studio `1044c0e6cfac3c26aeb3ffa774fe00d4d14cef90` (tree `0b934eca31742445d11c4254f78fd76aef6c8129`), Core `3ab5ada40910e727553d85d271c1d84ec5db2c41` (protocol 34), headless Chrome 158.0.8127.88 on macOS arm64.

## Regenerate

1. Build Studio at the source revision you want to show and identify the exact Core pin in `Cargo.toml` and `Cargo.lock`. Follow the [isolated-owner guide](../development/isolated-owner.md) with a new temporary data directory and a loopback-only mock provider. Do not copy or open an existing database.
2. Via the Core CLI, create four Threads and use `thread set --title` to name them **Release preview**, **Documentation pass**, **Sample data review**, and **Accessibility checklist**. Send **Release preview** the fixture prompt: "Check the release preview and tell me what still needs a decision." Return invented preview results from the mock, and have its shell call ask the fixture human whether the preview should open on Overview or Timeline. Do not answer the request before capturing.
3. Open the local Studio URL in a fresh temporary Chrome profile (`--user-data-dir`), always with `--use-mock-keychain` and `--password-store=basic`. Use light mode, a 1320 x 680 viewport at scale 1, and open **Release preview** with the **Awaiting reply** tab selected. Wait for the fixture text and fonts to load. Capture the viewport as PNG without browser controls, URLs, tokens, or personal data.
4. Verify the dimensions, byte limit, and legibility in the README preview. Stop the Chrome instance you started before removing its profile; stop the mock provider, Studio bridge, and isolated Core owner before removing the temporary data. Never replace the asset with a capture from an ordinary browser profile or real data directory.
