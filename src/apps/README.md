# Making an app

This is the Apps reference for the Studio agent guide. Studio serves it at `/_shellboy/guide.md` on its own port, beside `/_shellboy/api.js`, so it always matches the running API.

An app is a Thread artifact whose URI uses the `shellboy-app:` scheme. You write the app in a folder anywhere you like and register the folder; there is no apps directory and no manifest. Studio finds apps with `artifact.list`, and the person opens them from the Thread's Possessions or under Apps in the Web UI.

## Layout

```text
kanban/
  index.html  plain HTML and JS; there is no build step
  data/       the app's own files, also yours to read and edit from the Thread
```

Register the folder once, from your own working directory, in your own Thread:

```sh
shellboy artifact add --thread "$SHELLBOY_THREAD_ID" --uri shellboy-app:./kanban --title Kanban
```

The CLI turns `./kanban` into an absolute folder. The entry is always `index.html`. The Thread that owns the artifact is the app's bound Thread; forks and rewinds carry the app as Core copies artifacts. After a change, `shellboy artifact update --artifact A --uri shellboy-app:./kanban` publishes a new version reference; the person reloads the tab to see it.

Studio gets the folder's files through the owner (`artifact.read`), which serves only regular files inside the folder. `data/` is read and written by Studio on the local disk, so an app works where Studio and the folder are on the same machine.

A single HTML file is shared with `shellboy artifact add --uri PATH --mime text/html` instead. Studio shows it as one static page, without `shellboy.*` and without its neighbouring files.

Hand an app over by copying its folder, then register it again in the other Thread.

## Rules

- Use relative URLs only, without a leading `/`: `app.js`, `img/logo.png`, `data/x.json`. Never write a host or port into an app. Reach Shellboy only through `shellboy.*`.
- The page runs sandboxed with no origin of its own. **`localStorage`, `sessionStorage`, IndexedDB and cookies don't work** and throw or do nothing. Keep state with `shellboy.data.*`. A page can't navigate the window it sits in, and `alert` and popups are allowed.
- Scripts, styles, images and `fetch` from the app's own folder work with relative URLs, also `type="module"`. They and `shellboy.*` work through a tunnel as they do locally.
- `/_shellboy/api.js` is added to every HTML page for you, and errors on the page are shown to the person with a button that sends them to the bound Thread.
- Keep it small enough to read. Load nothing from other hosts if a local copy will do: the app should work offline.

## API

Every call returns a promise and rejects with an `Error` that has a `code`.

| Call | Result |
|---|---|
| `shellboy.app` | `{name, title, thread}`, after `await shellboy.ready` |
| `shellboy.data.read(path)` | `{exists, text, hash}`, UTF-8, up to 8 MiB |
| `shellboy.data.write(path, text, {hash})` | `{hash}`. With `hash`, fails with code `conflict` if the file changed since you read it; `hash: null` means it must not exist yet. Without the option, overwrites |
| `shellboy.data.list(path?)` | `{entries: [{name, dir, size}]}` |
| `shellboy.data.onChange(fn)` | Calls `fn({paths})` soon after any file in `data/` changes, whoever wrote it: your Thread's shell, an action or the page itself. Returns a function that stops it. Watches up to 4096 entries, 8 folders deep |
| `shellboy.thread.send(text, {thread, deliver})` | Sends a message, recorded as from `app:<name>`, not from a person. `deliver` is `next` (default) or `complete`; `now` fails with Shellboy's code `invalid_argument`, passed through unchanged |
| `shellboy.thread.get(thread?)` | A Thread details object: `thread_id`, `title`, `cwd`, `connection`, `model`, `agents_path`, `shells_count`; optional fields include `run_id`, `turn_id`, `parent_thread_id`, `effort` and `archived_at` |
| `shellboy.thread.messages({thread, limit, cursor, since})` | `{items, limit, filters, next_cursor?}`, oldest first, as `shellboy history list` returns them |
| `shellboy.threads.list({query, limit, cursor, archived})` | `{items, limit, filters, next_cursor?}`; each item has `thread_id`, `title`, `cwd`, `state`, `activity`, `updated_at` and `excerpt`; `parent_thread_id` and `archived_at` may be omitted |
| `shellboy.thread.onChange(fn, {thread})` | Calls `fn()` when that Thread may have changed; re-read then. Returns a function that stops it. `{list: true}` also watches the Thread list |
| `shellboy.run(action, args, {timeoutMs})` | Runs a script from `actions/`: `{exit_code, stdout, stderr, stdout_truncated, stderr_truncated, timed_out, duration_ms}` |

These thread calls return the owner's fields directly: use `thread_id`, `title`,
and `cwd` exactly, not `id`, `name`, or `working_directory`. `cwd` is the
Thread's current working directory, not necessarily the directory of every past
shell. List results are paginated; follow `next_cursor` only when needed.
`thread.get` gives configuration and current Run/Turn IDs; `state` is on each
`threads.list` item, not guaranteed on `thread.get`.

The bound Thread is the artifact's owner Thread. An archived one still works. Deleting the Thread deletes the artifact record, so the app no longer opens.

## actions/

`run("report", {days: 7})` runs the file in `actions/` named `report`, or `report` plus one extension. The interpreter comes from the extension:

| File | Runs as |
|---|---|
| `.py` | `python3`, or `py -3` on Windows |
| `.js`, `.mjs` | `node` |
| `.sh` | `sh` |
| `.ps1` | `powershell -NoProfile -File` |
| `.cmd`, `.bat` | `cmd /C`, on Windows |
| anything else | the file itself, which must be executable |

The working folder is the app's folder. `args` arrives as JSON on stdin. `SHELLBOY_APP_NAME` and `SHELLBOY_APP_DATA` are set, and credentials come from the environment the gateway was started in, so the app's page never sees them. The limit is 60 s by default and 600 s at most, and 1 MiB each of stdout and stderr; past that the output is cut and marked. `actions/` can't be fetched from the page.

An action never overlaps itself: a call while it's running rejects with code `already_running`. So a timer in the page is safe, and it should just skip that tick:

```js
setInterval(() => shellboy.run("fetch-issues").then(show).catch((e) => { if (e.code !== "already_running") throw e; }), 60000);
```

## Shared styles (optional)

`<link rel="stylesheet" href="/_shellboy/ui.css">` gives the Web UI's colour tokens, following the person's theme: `var(--bg)`, `--panel`, `--fg`, `--muted`, `--accent`, `--ok`, `--wait`, `--bad`, `--line`, and `--font-sans`, `--font-mono`. Classes: `.sb-page` for a page, `.sb-btn`, `.sb-field`, and `.sb-status.running`, `.waiting`, `.recovery`, `.ok`, `.failed` for states, which differ by shape as well as colour.

## Patterns

**Keep a list both you and the page edit.** Store it as JSON in `data/`, and write with the hash, so a concurrent edit is noticed rather than lost:

```js
await shellboy.ready;
async function update(change) {
  for (let i = 0; i < 3; i++) {
    const { exists, text, hash } = await shellboy.data.read("items.json");
    const next = change(exists ? JSON.parse(text) : []);
    try { return await shellboy.data.write("items.json", JSON.stringify(next, null, 2), { hash: exists ? hash : null }); }
    catch (e) { if (e.code !== "conflict") throw e; }
  }
  throw new Error("Kept changing while saving");
}
```

**The app is how the person talks with the Thread.** This is the main pattern: the Thread writes state to `data/`, the app renders it, and the person's answer returns by `thread.send`. It suits a guided lesson with diagrams and questions, a review queue, or anything that would otherwise be a long conversation.

```js
// In the page: draw whatever the Thread last wrote, and send answers back.
async function draw() {
  const { exists, text } = await shellboy.data.read("state.json");
  render(exists ? JSON.parse(text) : { step: "starting" });
}
shellboy.data.onChange(draw);
await shellboy.ready;
draw();
form.onsubmit = () => shellboy.thread.send(JSON.stringify({ answer: input.value }));
```

```sh
# In the Thread's shell: write the next state. Write to a temp name and rename, so the page never reads half a file.
cat > lesson/data/.next <<'JSON'
{"step": "question", "text": "Which of these is a stable sort?", "choices": ["merge", "quick"]}
JSON
mv lesson/data/.next lesson/data/state.json
```

**How the Thread knows the app sent it.** A message from `thread.send` is saved with the sender label `app:<name>`, not as from a person. You can read it with `shellboy history list --thread "$SHELLBOY_THREAD_ID"` (`provenance.sender.label`) or `shellboy message get --message ID`. It isn't in the text you are given, though: your input shows only the message. So have the page say what it is, for instance by sending JSON such as `{"from": "lesson", "answer": "merge"}`, and check the label if it matters who sent it. A person using the normal conversation is saved with the label `web`, and marked as human.

**Ask the Thread to do something, and show when it's done.** Send a request, and re-read when files change:

```js
await shellboy.thread.send("Summarise today's mail into data/summary.md");
shellboy.data.onChange(render);
```

`thread.onChange` tells you the conversation changed, for the rare page that shows it. Prefer `data/`: the page shouldn't have to parse a conversation.

**A live dashboard, for example from an issue tracker.** Put the fetch in `actions/`, read credentials from the environment, print JSON, and call it from a timer as shown above. The person starts the gateway with the variable set, and the page never sees it:

```js
const out = await shellboy.run("fetch", { days: 7 });
if (out.exit_code !== 0) throw new Error(out.stderr);
render(JSON.parse(out.stdout));
```

**Charts.** Draw inline SVG from `data/` files; no library is needed for bars and lines.

## Checking your work

You can't open a browser from the Thread. Keep logic in small functions, test `actions/` by running them directly, and ask the person to open the app under Apps and press the send button if an error shows.

## Named instances

After `await shellboy.ready`, `shellboy.instance` is the selected instance name,
or `null` for an ordinary app. Instance names use ASCII letters, digits, `_`,
and `-`. By convention, put per-instance files under `data/<instance>/` and
use `data.onChange` to observe that instance's files. Data paths are not an
authorization boundary; the app can still access other app data.
