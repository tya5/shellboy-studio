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

**Origin (decided for WebView2 and WKWebView).** One loopback port per app, on the host name the Web UI was reached by: `http://127.0.0.1:<port>`. No name resolution is involved, so it doesn't depend on `*.localhost` resolving in any engine, and distinct ports are distinct origins by the same-origin rule in every browser. It's decided by one function, `app_origin` in `src/apps/mod.rs`, and apps use only relative URLs, so the scheme can change without touching an app. Ports come from the range after the bridge's own, are bound on first open, end with the bridge, and are remembered in `<config dir>/app-ports.json`, so an app keeps its origin across restarts where the port is free. If it isn't, the app moves, which is why the guide says not to rely on `localStorage`.

**Isolation.** A session comes from a one-time ticket that only the authenticated Web UI can ask for (`apps.open` over `/ws`; 60 s, single use), and becomes an `HttpOnly; SameSite=Strict` cookie named by port. Cookies ignore ports, so a browser does send the Web UI's session cookie to an app's port and the reverse. Therefore: the cookies are HttpOnly, so a page can't read them; each server looks only at its own; and `Origin` must equal `Host` on `/ws`, `/auth` and every app API call, so an app's page can't drive the Web UI or another app. `tests/apps.rs` tests this with a valid cookie attached. Pages carry `frame-ancestors` for the Web UI's origin. As decided, there's no per-app restriction beyond this.

**API.** `/_shellboy/api.js`, added to every HTML page ahead of the app's scripts, posting to the same-origin `/_shellboy/call`. Chosen over `postMessage` as the simpler one: no relay through the Web UI, and an app works in its own tab if opened with a ticket. `data.read/write/list` (8 MiB, temp and rename, SHA-256 `hash` compared under a per-app lock), `thread.send` (`human: false`, `sender_label: app:<name>`), `thread.get`, `thread.messages`, `threads.list`, `thread.onChange` (a long poll on one hub session per app, so it adds no owner connection), and `run`.

**`run`.** By extension: `.py` is `python3` (`py -3` on Windows), `.js`/`.mjs` is `node`, `.sh` is `sh`, `.ps1` is `powershell -NoProfile -File`, `.cmd`/`.bat` is `cmd /C`, anything else runs as the file. No shell parses the name. 60 s by default and 600 s at most, 1 MiB each of stdout and stderr, 4 at once. Args are JSON on stdin; the working folder is the app's. It kills the script on timeout or a closed page, though a child it started in turn can outlive it. Credentials come from the gateway's environment.

**Web UI.** Apps is in the left navigation, and under More on a phone. The pane has tabs on top; an open app's iframe stays mounted while other tabs or views show, so moving back to the Web UI loses nothing. `#/apps/<name>` keeps the choice. The Web UI CSP gains `frame-src http: https:`, since an app's port isn't known in advance.

**Breakage.** `api.js` reports script errors, failed loads and unhandled rejections to the frame by `postMessage`. The Web UI accepts them only from that app's own frame and origin, shows them as text (at most 20 per tab), and offers a button that sends them to the bound Thread, recorded as from the person. A missing entry file returns a page that reports itself. A deleted bound Thread leaves the app open with a notice, and `thread.*` calls reject; an archived one still works, with a note.

**Shared styles.** `/_shellboy/ui.css`: the three token files and status classes. Optional. The frame sends the theme, and `api.js` sets `data-ds`.

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| A port per app rather than `*.localhost` | Requested for WebView2 and WKWebView. `*.localhost` resolution wasn't verifiable here; a port needs none | One function changes it |
| Same-origin HTTP API rather than `postMessage` | Fewer moving parts; the frame isn't a relay | Tauri IPC needs a relay |
| One hub session per app for hints | Bounded; no owner connection. Two tabs of one app share and can split hints, which are only hints | It shows up in use |
| Error report from the button is recorded as from the person | They pressed it | — |
| `sha2` added as a direct dependency, `=0.11.1`, same version as Shellboy | The data hash; compiles nothing new | — |
| `tokio` gains `process`, `fs` and `io-util` | `run` and files. Already in the tree | — |

## Limits, and what isn't verified

- **Tunnels.** A tunnel that forwards only the Web UI's port (`tailscale serve`, `ssh -L`) doesn't reach an app's port, so apps don't open remotely that way. A LAN listen address does expose the ports, with the same session rule. A remote path needs a path-based scheme or forwarding each port, behind `app_origin`.
- **Other engines.** Verified in Chrome only. WebView2, WKWebView, Safari and Firefox weren't run. Reasoning, not a test: loopback by IP needs no resolution; the iframe is same-site with the Web UI, so third-party cookie blocking shouldn't apply. Mixed content: an `https://` tunnelled Web UI framing `http://` would be blocked.
- **Windows.** `run`'s `py -3`, `.ps1` and `.cmd` paths and the `.exe` lookup are untested. Symlink checks are unix-tested only.
- **Sharing.** A handed-over app keeps a `thread` ID that means nothing on the other machine: it opens, with the missing-Thread notice, and the person edits `app.json`. No picker yet.
- **A real model** hasn't made an app. See the guide; the flow is `SHELLBOY_DATA_DIR` (set in model shells) plus `apps/README.md`. The Agent Guide needs a pointer, which is a core change.
