# Making an app

This is the Apps reference for the Studio agent guide. Studio serves it at `/_shellboy/guide.md` on its own port, beside `/_shellboy/api.js`, so it always matches the running API.

An app is a Thread artifact whose URI uses the `shellboy-app:` scheme. You write the app in a folder anywhere you like and register the folder; there is no apps directory and no manifest. Studio finds apps with `artifact.list`, and the person opens them from the Thread's Possessions or under Apps in the Web UI.

## The whole app in one picture

```text
Thread (owns the whole app; you build and change both halves)
  artifact = frontend: the folder (shellboy-app:), versioned, opened by the person
  service  = a named Core service of this Thread, resolved by Studio
  data/    = app state: the page and Thread read and write it
```

The page never starts anything. It reads `data/`, and calls a named service of its owning Thread with `shellboy.call(serviceName, path, body)` when it must act. Several pages can call the same service, and one page can combine calls to several services; services do not know about each other. A service can also update the app's `data/` when configured with that path; the page redraws through `data.onChange`. Forking or rewinding the Thread copies the artifact (the page) but not its service, so the backend stays with the original Thread. If a service fails, its Thread is notified; its output stays readable with `shellboy shell read`.

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

A single HTML file is shared with `shellboy artifact add --uri PATH --mime text/html` instead. Studio shows it as one static page, without `shellboy.*` and without its neighbouring files. Core does not inherit the MIME type on update, so pass `--mime text/html` on every `shellboy artifact update` of that page too; a version without it is no longer opened as a page.

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
| `shellboy.data.onChange(fn)` | Calls `fn({paths})` soon after any file in `data/` changes, whoever wrote it: your Thread's shell, a service configured to use that folder, or the page itself. Returns a function that stops it. Watches up to 4096 entries, 8 folders deep |
| `shellboy.thread.send(text, {thread, deliver})` | Sends a message, recorded as from `app:<name>`, not from a person. `deliver` is `next` (default) or `complete`; `now` fails with Shellboy's code `invalid_argument`, passed through unchanged |
| `shellboy.thread.get(thread?)` | A Thread details object: `thread_id`, `title`, `cwd`, `connection`, `model`, `agents_path`, `shells_count`; optional fields include `run_id`, `turn_id`, `parent_thread_id`, `effort` and `archived_at` |
| `shellboy.thread.messages({thread, limit, cursor, since})` | `{items, limit, filters, next_cursor?}`, oldest first, as `shellboy history list` returns them |
| `shellboy.threads.list({query, limit, cursor, archived})` | `{items, limit, filters, next_cursor?}`; each item has `thread_id`, `title`, `cwd`, `state`, `activity`, `updated_at` and `excerpt`; `parent_thread_id` and `archived_at` may be omitted |
| `shellboy.thread.onChange(fn, {thread})` | Calls `fn()` when that Thread may have changed; re-read then. Returns a function that stops it. `{list: true}` also watches the Thread list |
| `shellboy.call(serviceName, path, body?)` | Resolves `serviceName` only among services owned by this app's Thread through Core (there is no cross-Thread service target), then makes one `POST path` with `body` as JSON and the service token. Returns `{status, body}`, where `body` is parsed JSON for a JSON answer, else text. Rejects with `no_backend` (unknown service), `backend_down`, `backend_refused`, `backend_timeout` (25 s), `backend_failed`, `too_large` (over 8 MiB either way) or `invalid_path`. Other HTTP statuses are the service's answer and arrive as results. No retry: the page decides |

These thread calls return the owner's fields directly: use `thread_id`, `title`,
and `cwd` exactly, not `id`, `name`, or `working_directory`. `cwd` is the
Thread's current working directory, not necessarily the directory of every past
shell. List results are paginated; follow `next_cursor` only when needed.
`thread.get` gives configuration and current Run/Turn IDs; `state` is on each
`threads.list` item, not guaranteed on `thread.get`.

The bound Thread is the artifact's owner Thread. An archived one still works. Deleting the Thread deletes the artifact record, so the app no longer opens.

## Services

Add a service to the same Thread that owns the app, giving it a stable name. Its working folder need not be the artifact folder:

```sh
shellboy service add --thread "$SHELLBOY_THREAD_ID" --name tracker --cwd ./tracker --command 'python3 service.py'
```

The service listens on loopback, chooses a free port and authenticates requests with its per-start token. Core provides a private runtime endpoint file through `SHELLBOY_SERVICE_ENDPOINT_FILE`; the service writes its `{port, token}` there. Core keeps that endpoint scoped to the named service and removes it when the service stops, is disabled or removed. Studio asks Core for the endpoint of the named service belonging to this app's Thread, and forwards the call with its token. Neither the service endpoint nor its token is placed in the artifact folder or exposed to the page.

Hidden files and folders (names starting with `.`, such as `.env` and `.git`) are never served to the page. Keep credentials out of the artifact folder: read them from the service's environment or a file the person put elsewhere. The service's output stays in Core (`shellboy shell read`), and it can use `shellboy message ask` and waits. Periodic work uses `shellboy schedule`.

## Redistributing an app

An app is a portable folder with no Thread ID inside. To share it, ship the folder (git or zip) with:

- a `README.md` with the install steps (`shellboy artifact add --uri shellboy-app:./FOLDER`, then `shellboy service add ...`), the credentials it needs and where the person puts them (outside the folder), and the preference questions to ask the person first;
- a `.gitignore` that excludes `data/`.

Installing is the person asking a Thread to follow that README; there is no install command.

## Shared styles (optional)

`<link rel="stylesheet" href="/_shellboy/ui.css">` gives the Web UI's colour tokens, following the person's theme: `var(--bg)`, `--panel`, `--fg`, `--muted`, `--accent`, `--ok`, `--wait`, `--bad`, `--line`, and `--font-sans`, `--font-mono`. Classes: `.sb-page` for a page, `.sb-btn`, `.sb-field`, and `.sb-status.running`, `.waiting`, `.recovery`, `.ok`, `.failed` for states, which differ by shape as well as colour.

## Patterns

Two pages can share one service: register `tracker` once in the Thread, then both `index.html` and `admin.html` can call `shellboy.call("tracker", "/issues")`. A dashboard page can combine independent services without coupling them:

```js
const [issues, dates] = await Promise.all([
  shellboy.call("tracker", "/issues"),
  shellboy.call("calendar", "/events"),
]);
renderDashboard(issues.body, dates.body);
```

The page (or the Thread) composes the results; `tracker` and `calendar` remain unaware of each other.

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

**A tracker watcher: a service plus its board page.** The service polls the tracker every 5 minutes and writes `data/issues.json`; the page draws it, and its refresh button calls `/refresh`, which runs one poll and returns its result. A failed poll ends the process with a non-zero exit, so Core's failure notice reaches your Thread.

```python
# service.py, started with: shellboy service add --thread "$SHELLBOY_THREAD_ID" --name tracker --cwd ./tracker --command 'python3 service.py'
import http.server, json, os, secrets, threading, urllib.request
token = secrets.token_hex(16)
lock = threading.Lock()
def poll():
    req = urllib.request.Request("https://tracker.example/api/issues",
        headers={"Authorization": "Bearer " + os.environ["TRACKER_TOKEN"]})  # credential from the environment, not the folder
    with urllib.request.urlopen(req) as r: data = r.read()
    with open("data/.next", "wb") as f: f.write(data)
    os.replace("data/.next", "data/issues.json")   # the page's data.onChange fires
def loop():
    while True:
        try:
            with lock: poll()
        except Exception as e:
            print("poll failed:", e, flush=True)
            os._exit(1)   # a non-zero exit is what makes Core notify the Thread
        wake.wait(300); wake.clear()
wake = threading.Event()
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer " + token:
            self.send_response(401); self.end_headers(); return
        try:
            with lock: poll()          # /refresh runs one poll and returns its result
            code, body = 200, {"ok": True}
        except Exception as e:
            code, body = 502, {"ok": False, "error": str(e)}
        out = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
with open(os.environ["SHELLBOY_SERVICE_ENDPOINT_FILE"], "w", encoding="utf-8") as f:
    json.dump({"port": srv.server_port, "token": token}, f)
threading.Thread(target=loop, daemon=True).start()
srv.serve_forever()
```

```js
// In the page.
await shellboy.ready;
async function draw() {
  const { exists, text } = await shellboy.data.read("issues.json");
  render(exists ? JSON.parse(text) : []);
}
shellboy.data.onChange(draw);
draw();
refresh.onclick = () => shellboy.call("tracker", "/refresh", {}).catch((e) => show(e.code === "no_backend" ? "The tracker service is not running" : e.message));
```

**Charts.** Draw inline SVG from `data/` files; no library is needed for bars and lines.

## Checking your work

You can't open a browser from the Thread. Keep logic in small functions, test the service by running it directly, and ask the person to open the app under Apps and press the send button if an error shows.

## Named instances

After `await shellboy.ready`, `shellboy.instance` is the selected instance name,
or `null` for an ordinary app. Instance names use ASCII letters, digits, `_`,
and `-`. By convention, put per-instance files under `data/<instance>/` and
use `data.onChange` to observe that instance's files. Data paths are not an
authorization boundary; the app can still access other app data.
