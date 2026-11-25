# README Screenshot

`studio-reply-duties.png` is a development-build capture using invented Threads and messages, not a user's session. Keep this one light-theme PNG at 1x scale and no more than 250 KiB. A light image with its own opaque background remains readable against either GitHub theme.

Capture source: Studio `1044c0e6cfac3c26aeb3ffa774fe00d4d14cef90` (tree `0b934eca31742445d11c4254f78fd76aef6c8129`), Core `3ab5ada40910e727553d85d271c1d84ec5db2c41` (protocol 34), headless Chrome 158.0.8127.88 on macOS arm64.

## Regenerate

1. Build Studio and the exact Core revision in its manifest and lockfile. Create a fresh temporary directory with `mktemp -d`, a private `home` inside it, and a new `data` path. For the mock, owner, Core CLI and Studio bridge, use a clean environment with `HOME` set to that private home, `TMPDIR` to the temporary directory, `SHELLBOY_DATA_DIR` to the new data path, and a minimal `PATH` (no inherited provider credentials or proxy variables). Use absolute paths to the binaries. The standard isolated-owner runner does not send to a model; use the loopback fixture below instead.
2. After the fixture owner reports ready, use the Core CLI with `--config "$root/config.toml" --data-dir "$root/data"` to create four Threads and use `thread set --title` to name them **Release preview**, **Documentation pass**, **Sample data review**, and **Accessibility checklist**. Send **Release preview** the fixture prompt: "Check the release preview and tell me what still needs a decision." Return invented preview results from the mock, and have its shell call ask the fixture human whether the preview should open on Overview or Timeline. Do not answer the request before capturing.
3. Open the local Studio URL in a fresh temporary Chrome profile (`--user-data-dir`), always with `--use-mock-keychain` and `--password-store=basic`. Use light mode, a 1320 x 680 viewport at scale 1, and open **Release preview** with the **Awaiting reply** tab selected. Wait for the fixture text and fonts to load. Capture the viewport as PNG without browser controls, URLs, tokens, or personal data.
4. Verify the dimensions, byte limit, and legibility in the README preview. Stop the Chrome instance you started before removing its profile; stop the mock provider, Studio bridge, and isolated Core owner before removing the temporary data. Never replace the asset with a capture from an ordinary browser profile or real data directory.

### Loopback Responses fixture

Run the following as a temporary `.mjs` file with Node.js. Pass the absolute fixture Core path as its first argument. It prints a loopback base URL; use that exact value in the config. The first request runs one fixed synthetic shell command; the follow-up returns a fixed answer. No request text becomes part of the command.

```js
import { createServer } from 'node:http';
const core = process.argv[2];
if (!core?.startsWith('/')) throw new Error('Pass an absolute Core binary path');
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
let count = 0;
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model' }] }));
  }
  if (req.method !== 'POST' || req.url !== '/v1/responses') {
    res.writeHead(404);
    return res.end();
  }
  for await (const _ of req) { /* Discard the synthetic request body. */ }
  const id = ++count;
  const item = id === 1 ? {
    id: 'fixture-check', type: 'function_call', call_id: 'fixture-check',
    name: 'shell', status: 'completed',
    arguments: JSON.stringify({ command: `printf '3 sample records checked\\n'; ${quote(core)} message ask --to human --text 'Should the release preview open on Overview or Timeline?'` }),
  } : {
    id: `m-${id}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'The preview is ready. I checked the three sample records and found no missing titles.\n\n- The overview uses the new card layout.\n- The old layout is still available as a fallback.\n\nWould you like the preview to open on the Overview or the Timeline?' }],
  };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { id: `r-${id}`, status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 160, total_tokens: 180 } } })}\n\n`);
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/v1`));
```

Put the printed URL in `$root/config.toml` (replace `PORT`):

```toml
default_connection = "local"
default_model = "mock"
[connections.local]
base_url = "http://127.0.0.1:PORT/v1"
```

Start the isolated owner with `shellboy serve --config "$root/config.toml" --data-dir "$root/data"`. After sending the fixture prompt, wait for its Turn to complete before opening Studio. The capture used `shellboy-studio --data-dir "$root/data" --config-dir "$root/bridge-config" --listen 127.0.0.1:19445 --no-auth` on a free loopback port, with only the synthetic owner attached. Wait until the **Awaiting reply** panel itself displays the question, not just until the conversation loads.
