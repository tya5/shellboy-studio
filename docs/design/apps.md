# Apps

Status: proposal from the 2026-11-07 discussion; not implemented. Follows Branches and Threads.

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
| `thread.send(text, thread?)` | Message a Thread, recorded as coming from the app |
| `thread.messages(thread?)`, `threads.list()` | Read conversations and the Thread list |
| `thread.onChange(fn)` | Change hints from the shared `events wait` |
| `run(action, args)` | Run a script from the app's `actions/` with a time and output limit; returns its output |

## Open

- `run`: interpreter lookup on Windows, limits, and credentials, which the script gets from the environment and the app never sees.
- Sharing: a shared app has no bound Thread on the other machine. Offer to create or pick one.
- Breakage: the gateway shows load errors and script failures in its own frame and offers sending them to the bound Thread.
- Whether apps load the design system CSS by default.
