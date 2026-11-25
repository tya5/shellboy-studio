# README Screenshot

`studio-reply-duties.png` is a development-build capture using invented Threads and messages, not a user's session. Keep this one light-theme PNG at 1x scale and no more than 250 KiB. A light image with its own opaque background remains readable against either GitHub theme.

Capture source: Studio `a5f4de81963d002ed96d811f366c73ab1b1d091c` (tree `394fa6f101befb2cfd1d543f0b1cdcdf96ebda11`), Core `3ab5ada40910e727553d85d271c1d84ec5db2c41` (tree `014f3946ef74084edd8c603a4ed838e9b065d8a2`, protocol 34), headless Chrome 158.0.8127.88 on macOS arm64.

## Regenerate

1. Build Studio and the exact Core revision in its manifest and lockfile. Create a private synthetic root with `mktemp -d /Users/Shared/Studio-Demo-XXXXXX`, a `home` inside it, and a new `Workspace` data path. Use a clean environment for the mock, owner, CLI and bridge: set `HOME` to the private home, `TMPDIR` to the root, and `SHELLBOY_DATA_DIR` to `Workspace`; use a minimal `PATH` and no inherited credentials or proxy variables. Use absolute paths to the binaries.
2. Start the loopback fixture and isolated owner as described below. Create four Threads with the root as their working directory. Use `thread set --title` to name them **Release preview**, **Documentation pass**, **Sample data review**, and **Accessibility checklist**. Keep a synthetic Turn in **Documentation pass** active while **Release preview** sends its outgoing Ask. Then send a named incoming CLI Ask to **Release preview** and hold that Turn so the reply duty remains pending.
3. Start `shellboy-studio --data-dir "$root/Workspace" --config-dir "$root/bridge-config" --listen 127.0.0.1:19445` on a free loopback port. Keep authentication enabled; use the token from the isolated bridge config to sign in. Do not print the token or include it in the image.
4. Open Studio in a fresh temporary Chrome `--user-data-dir` with both `--use-mock-keychain` and `--password-store=basic`. Use English, light mode, a 1600 x 810 CSS px viewport at 1x, and a dock width preference of 480 CSS px. Open **Release preview** and verify **Awaiting reply** has one outgoing request to **Documentation pass**. Select **Reply needed** for the capture and verify its only row shows **CLI: Jordan Lee**. Both reply badges should show `1`. Wait for fonts, move the pointer off controls, and capture the viewport as PNG, without browser chrome or DOM edits.
5. Open the decoded PNG and check light colors, the selected dock tab, both badges, the named request, and the synthetic footer path. Check dimensions, legibility, and the 250 KiB limit. Stop Chrome before removing its profile; then stop the mock, bridge, and owner and remove the synthetic root.

### Loopback Responses fixture

Run the following as a temporary `.mjs` file with Node.js. Pass the absolute Core binary path and a private stage-file path as arguments. The mock prints its loopback base URL. Use the stage file to hold the recipient first, let the source complete, and then hold the incoming Ask. No request text becomes part of the shell command.

```js
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
const [, , core, stageFile] = process.argv;
if (!core?.startsWith('/') || !stageFile?.startsWith('/')) throw new Error('Pass absolute paths');
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
  const [stage, recipient] = (await readFile(stageFile, 'utf8')).trim().split(/\s+/);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.flushHeaders();
  if (stage !== 'source') {
    process.stdout.write(`Holding ${stage} request\n`);
    if (!res.destroyed) await once(res, 'close');
    return;
  }
  const id = ++count;
  const item = id === 1 ? {
    id: 'fixture-check', type: 'function_call', call_id: 'fixture-check',
    name: 'shell', status: 'completed',
    arguments: JSON.stringify({ command: `printf '3 sample records checked\\n'; ${quote(core)} message ask --thread ${quote(recipient)} --deliver complete --text 'Should the release preview open on Overview or Timeline?'` }),
  } : {
    id: `m-${id}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'The preview is ready. I checked the three sample records and found no missing titles.\n\n- The overview uses the new card layout.\n- The old layout is still available as a fallback.\n\nWould you like the preview to open on the Overview or the Timeline?' }],
  };
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

Start the isolated owner with `shellboy serve --config "$root/config.toml" --data-dir "$root/Workspace"`. Pass the same config and data directory to the CLI. Before sending anything, write `recipient` to the stage file. Send **Documentation pass** the message "Check the release notes draft and wait for my next question." and wait for the mock to report `Holding recipient request`.

Write `source RECIPIENT_THREAD_ID` (using the actual **Documentation pass** ID) to the stage file. Send **Release preview** the message "Check the release preview and tell me what still needs a decision." with `message send --sender-label 'Alex Morgan'`. Wait for this Turn to complete. The first source response sends a pending cross-Thread Ask; the follow-up supplies the preview text. The recipient's held Turn prevents premature delivery.

Write `incoming` to the stage file. Send the incoming Ask with `message ask --thread SOURCE_THREAD_ID --sender-label 'Jordan Lee' --deliver now --text 'Can you confirm the title for the release notes?'`. Leave the model request held until after capture. Verify the two live panel rows before taking the PNG.
