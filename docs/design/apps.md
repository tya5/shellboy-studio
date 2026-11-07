# Apps

Status: implemented (2026-11-07), local only. Code in `src/apps/`, `web/ui-core/src/apps.ts`, `web/designs/console/screens/Apps.tsx`.

A person asks a Thread to make an app. The Thread writes a small web app, the gateway hosts it, and the Web UI shows it. Typical apps by theme: todo management, a mail viewer, monitoring a work task, data analysis and visualization.

## Decided with the user

- Shellboy communication goes through the gateway. Apps get a separate origin and never see the Web UI token.
- Navigation: Apps in the left navigation; the right pane has tabs on top to move between open apps.
- Apps can send requests to Shellboy. Delivered from the app's own UI: buttons and message boxes are the author's choice.
- No build step: HTML and JS as written. Dynamic languages such as Python are fine for server-side scripts. Ease of use comes first.
- Version control is the user's choice, not required by the format.
- Sharing with colleagues is wanted: an app is a folder that can be handed over.
- Breakage must be considered.

## Security stance (user, 2026-11-07)

Personal use comes first: no permission declarations, approval prompts or per-app restrictions now. Only what is hard to add later is built in from the start: apps reach Shellboy only through the provided JS API, which the gateway serves, and on their own origin, so a stricter mode can be added later without rewriting apps.

## Uses the user wants (2026-11-07)

- A communication tool with a Thread, in place of conversation.
- A learning app made on the spot: the Thread leads with diagrams and comprehension checks, and guides the person.
- A live project dashboard from Jira or Redmine issue lists.

So a Thread must be able to drive the screen: it writes to `data/` from its shell, and the open app updates at once. Answers come back as messages the Thread can act on.

## Shape

```text
apps/<name>/
  app.json    name, entry, bound Thread
  index.html
  data/       the app's own files, shared with its Thread
  actions/    optional scripts the app can run
```

Gateway API for an app. The bound Thread is the default target; an app may name another Thread.

| API | Purpose |
|---|---|
| `data.read`, `data.write` | Own `data/`, with a hash to detect concurrent writes |
| `data.onChange(fn)` | The Thread or a script changed `data/`; the screen updates |
| `thread.send(text, thread?)` | Message a Thread, recorded as coming from the app |
| `thread.messages(thread?)`, `threads.list()` | Read conversations and the Thread list |
| `thread.onChange(fn)` | Change hints from the shared `events wait` |
| `run(action, args)` | Run a script from the app's `actions/` with a time and output limit; returns its output |

## What was built

The product ships no app: no sample, no demo folder. Tests write throwaway apps into a temp folder. On start the gateway writes only `apps/README.md`, the guide a model reads (`src/apps/README.md`), so no core change is needed.

**Location.** `<owner data dir>/apps/<name>/`, or `--apps-dir`. It follows the data directory, so a temporary owner has its own apps, and the guide's location is one a Thread can derive. This is the one exception to "no files in the data directory other than `endpoint.json`": the gateway owns this subfolder, and Shellboy's collection touches only its own folders (`gc.rs` at v0.10.0 walks `managed` and `tmp`). Discovery reads the folder on each list; there's no cache and no restart. A folder that can't be used stays listed with the reason.

**One port, opaque origins (user decision 2026-11-07).** Every app is served from the Web UI's own port, in an iframe with `sandbox` and without `allow-same-origin`. The page gets an opaque origin, so it can't read the Web UI's cookie, storage or DOM even though it shares a port. This replaces a port per app, which didn't survive a tunnel forwarding one port (`tailscale serve`, `ssh -L`). It relies on no name resolution and no extra listener, and `sandbox` is defined the same way in every engine, so by design it holds in WebView2 and WKWebView. That reasoning hasn't been tested in them.

What an opaque origin costs, and how each is handled:

| Consequence | Handling |
|---|---|
| No cookies are sent with the page's requests | Files are at `/a/<session>/<path>`. The session is 128 random bits in memory, minted by `apps.open` over the authenticated `/ws`, at most 256 of them, oldest dropped. A restart ends them, and reopening mints another |
| Its own files are cross-origin to it | `Access-Control-Allow-Origin: *` on those files, so module scripts and `fetch` work; the path is the capability |
| An uncaught error in a cross-origin script reads "Script error." | The gateway adds `crossorigin` to `<script>` tags with a local `src` in served HTML. Other hosts' tags stay as written |
| `localStorage`, IndexedDB and cookies don't work | Said in the guide, which points to `data.*` |
| The page can't call a same-origin API | The API goes by `postMessage` to the parent frame, which forwards it |

**Isolation.** Every file under `/a/` carries `Content-Security-Policy: sandbox ...; frame-ancestors 'self'`. That matters as much as the iframe attribute: opened directly in a tab, an HTML or SVG file would otherwise be same-origin with the Web UI. `nosniff` and `no-referrer` go with it, the latter so the path doesn't leak to another site. A sandboxed page's requests carry `Origin: null`, which `/ws` and `/auth` refuse even with a valid cookie attached; `tests/apps.rs` tests that. Pages can't navigate the top window. What's left, by the stance above: a page can navigate its own frame elsewhere, and the page it lands on can use that app's API, because the parent identifies an app by its frame. Pages may also fetch other hosts freely.

**API.** `/_shellboy/api.js`, added to every HTML page ahead of the app's scripts, talks to the parent by `postMessage`. The parent (`AppsHost`) finds the tab by the message's source window, ignoring anything the page says about who it is, and calls `apps.call {name, op, args}` over the Web UI's own `/ws`. So the Web UI's session authorizes the call, and a page can name neither an app nor a credential. In a desktop shell only the transport under `/ws` changes. Calls: `data.read/write/list` (8 MiB, temp and rename, SHA-256 `hash` compared under a per-app lock), `thread.send` (`human: false`, `sender_label: app:<name>`), `thread.get`, `thread.messages`, `threads.list`, `thread.onChange` and `data.onChange` (long polls that hold no owner connection), and `run`. Waiting calls don't take one of the Link's four call slots, or two apps would starve the Web UI; at most 64 calls per open app, 256 per tab at the bridge. Closing a tab cancels its calls. The incoming frame limit rises from 1 to 24 MiB to carry an 8 MiB write, escaped.

**`data.onChange`.** One watcher task per app, in the gateway, however many pages are open. It runs while a page waits and 30 s after, then ends with nothing left behind. Native file events would add a dependency and platform differences, so it is a stat walk of `data/` every 200 ms: at most 4096 entries, 8 folders deep, on the blocking pool, not following links. Pages long-poll one call (`data.wait`), so a tab has no polling loop of its own, and a change made between two waits isn't lost, because the version moves. A file changed to the same size within the file system's time resolution would be missed. Measured in Chrome on the temp owner, from `writeFileSync` in another process to the page's callback, 10 samples: 16, 29, 36, 44, 75, 79, 85, 172, 175, 190 ms (macOS, debug build, a nearly empty `data/`). These are observations, and the 200 ms interval is what drives them.

**`run`.** One at a time per action: a call while it's running rejects with `already_running`, so a page's timer can't pile up, and another action isn't held back. Actions inherit the gateway's environment, which is how a tracker's credentials reach them without the page seeing them. By extension: `.py` is `python3` (`py -3` on Windows), `.js`/`.mjs` is `node`, `.sh` is `sh`, `.ps1` is `powershell -NoProfile -File`, `.cmd`/`.bat` is `cmd /C`, anything else runs as the file. No shell parses the name. 60 s by default and 600 s at most, 1 MiB each of stdout and stderr, 4 at once. Args are JSON on stdin; the working folder is the app's. It kills the script on timeout or a closed page, though a child it started in turn can outlive it. Credentials come from the gateway's environment.

**Web UI.** Apps is in the left navigation, and under More on a phone. The pane has tabs on top; an open app's iframe stays mounted while other tabs or views show, so moving back to the Web UI loses nothing. `#/apps/<name>` keeps the choice. The Web UI CSP gains `frame-src 'self'`.

**Breakage.** `api.js` reports script errors, failed loads and unhandled rejections to the frame by `postMessage`. The Web UI accepts them only from that app's own frame, shows them as text (at most 20 per tab), and offers a button that sends them to the bound Thread, recorded as from the person. A missing entry file returns a page that reports itself. A deleted bound Thread leaves the app open with a notice, and `thread.*` calls reject; an archived one still works, with a note.

**Shared styles.** `/_shellboy/ui.css`: the three token files and status classes. Optional. The frame sends the theme, and `api.js` sets `data-ds`.

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| `data/` is watched by a bounded stat walk rather than native events | Simplest thing with one code path on every OS, and no new dependency. Uncertain: a large `data/` costs more per look, up to 4096 stats every 200 ms | Latency or cost shows up in use |
| One port with opaque origins, not a port per app (user decision) | Works through a one-port tunnel; no name resolution; no listeners to manage | A need for storage inside apps, which would need separate origins |
| API by `postMessage` through the frame | An opaque page has no session of its own, and the frame alone can say which app it is. The Web UI must be open for an app to work | — |
| One hub session per app for hints | Bounded; no owner connection. Two tabs of one app share and can split hints, which are only hints | It shows up in use |
| Error report from the button is recorded as from the person | They pressed it | — |
| `sha2` added as a direct dependency, `=0.11.1`, same version as Shellboy | The data hash; compiles nothing new | — |
| `tokio` gains `process`, `fs` and `io-util` | `run` and files. Already in the tree | — |

## Limits, and what isn't verified

- **Tunnels.** Apps use paths on the Web UI's port, so one forwarded port carries them. Checked in Chrome through a second Host name with `--allow-host`, not through a real `tailscale serve`.
- **Other engines.** Verified in Chrome only. WebView2, WKWebView, Safari and Firefox weren't run. An `https://` tunnel serves the frame `https://` as well, so mixed content doesn't arise, but that also wasn't run.
- **Windows.** `run`'s `py -3`, `.ps1` and `.cmd` paths and the `.exe` lookup are untested. Symlink checks are unix-tested only.
- **Sharing.** A handed-over app keeps a `thread` ID that means nothing on the other machine: it opens, with the missing-Thread notice, and the person edits `app.json`. No picker yet.
- **A real model** hasn't made an app. The flow is `SHELLBOY_DATA_DIR`, which model shells have, plus `apps/README.md`. A model only finds the guide with a pointer in Shellboy's Agent Guide, which is a core change.
- **The sender label doesn't reach the model.** `thread.send` saves `app:<name>`, and history shows it (real-owner test), but one captured request held only the text, with no label, and the same goes for `web`. The guide says so and has pages say who they are in the text. Core could put the label in the input.
- **Timer-driven `run`** is tested for no overlap, not for hours of use. A grandchild of an action can outlive a timeout.

### Manual app reload

Each open app tab offers an explicit reload. It mints a fresh file session and
remounts the iframe; it does not write or remove the app's `data/` files. App
file responses use `Cache-Control: no-cache` so cached files are revalidated.
The page is not automatically reloaded on file changes. A session-open failure
is shown, and the existing tab remains available.

### Named instances

A named instance is identified by the pair of an app name and a validated
instance name. An absent instance retains the existing route and API behaviour.
The route is `#/apps/NAME/INSTANCE`; each pair has its own tab and iframe.
Names used as path components must reject separators, dot components and `..`.
The page receives `shellboy.instance` as a string or `null`. App authors choose
how to store data, conventionally under `data/<instance>/`; this is a convention,
not a security boundary, and existing data calls retain their meaning.

Instance discovery needs a bounded, durable listing, including names opened
without yet writing data. The bridge owns this registry and its lifecycle; it
must not modify Shellboy's core or use its database. A shared app-wide watcher keeps up to 128 scoped snapshots per app. Each scope
uses only its own paths, so ordinary changes to another instance do not wake it.
The underlying scan is bounded; when truncated, changes outside its scanned set
may be missed and the response marks this. The watcher stops on bridge shutdown.
Unnamed legacy pages retain their existing app-wide notifications.

### Library and named tabs

The library uses a fixed All apps entrance and a scrollable strip of app tabs.
Reload is in the app toolbar. A tab's adjacent add control opens an inline name
field; a named tab and its toolbar use `App title: name`. Previously opened names
appear in the app's card. The UI calls these names, not instances; the existing
route and API terminology remain unchanged.

The New app panel sends a reviewed request in a new Thread. Five localized
prompt drafts are data in ui-core, not bundled apps. The folder picker reads at
most one 200-name `thread.cwds` page while the panel is open; the panel owns
and cancels that read on close or disposal. Loaded Thread-list order brings
known recent folders forward, followed by remaining names in owner order. The
currently selected Thread supplies the default. More than one page is not yet
listed, and the manual path remains available. The AGENTS.md guidance is
collapsed at the bottom of the library.
