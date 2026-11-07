# First-run connection setup

Status: implemented (2026-11-07), local only. Realises `architecture.md` §12 for the Web: someone with no connection opens Studio and reaches a first message from one screen, without editing a file. The core operations are Shellboy issue #269, on branch `issue-269/connection-setup` and in no release, so everything about their wire shape is an assumption held in one place (below).

Logic: `web/ui-core/src/setup.ts` (the steps), `presets.ts` (the services, plain data), wire adapter `web/data/src/connection-setup.ts`. Screen: `web/designs/console/screens/Setup.tsx`, route `#/setup`.

## Flow

1. **Service**: Anthropic, OpenAI, OpenRouter, LiteLLM proxy, Local, Other. Presets are data in `presets.ts` (label, `base_url`, dialect, key page, variable name), checked against Shellboy `docs/guides/configuration.md` and `config.example.toml`: dialects `responses`, `chat_completions`, `anthropic_messages`; Anthropic's native API uses `api_key_header = "x-api-key"` and `ANTHROPIC_API_KEY`.
2. **Key or address.** For Anthropic, OpenAI and OpenRouter, choosing the service calls `connection.test` with the preset's variable name and no key. If the owner has it set, the screen offers it once ("Use it" or "Enter a key instead"); if not, a key field with a link to the provider's key page. The screen says a Claude or ChatGPT subscription is separate from API keys and an API key is required. Local shows its address as an editable example (Ollama's default) and asks for no key. Nothing probes ports. Other asks for the address and the dialect and a key.
3. **Test**: `connection.test` again with the typed key or the variable. The result is reported as facts: "The model list was fetched: N models (HTTP 200)" or the failure class with its status and a plain next step (auth, url, unreachable, timeout, tls, rate limit, server, empty list, other). It never says the key is valid. A call that couldn't run is shown as that, not as a verdict on the key.
4. **Model**: chosen from the returned list (filter when more than 50, never more than 50 drawn) or typed. Nothing is preselected. For Local, a warning sits beside the picker: Ollama's default context can be as small as 4k tokens depending on VRAM, Ollama recommends at least 64k for agents, with a link to `https://docs.ollama.com/context-length`.
5. **Save**: `credentials.set` if a key was typed, then `config.get` for the hash and `config.set` writing `connections.<name>.{base_url,api,api_key_env,api_key_header}`, `default_connection` and `default_model`. The result says where the key is stored (the path the owner reports, else `credentials.toml` beside `config.toml`), that it is a plain-text file only the account can read, and whether a restart is needed, as the `config.set` result reports it (`restart_required`: true says to restart `shellboy serve`; false says the next request picks it up; absent says it wasn't reported). Then a link to Conversation. A connection name that exists is not overwritten: the new one is `anthropic-2` and so on.

Reaching it: it opens by itself once, from the start route, when `config.get` shows no connection in the file or in what the owner loaded; "Not now" leaves it, and it doesn't come back until the next page load. Settings > Connections always links to it. If the file can't be read (invalid), it isn't opened by itself and says so when opened.

## Capability and the older owner

The screen is behind the capability `connection.setup`, which `seam::owner_capabilities` advertises only in a build with the Cargo feature `next-connection-setup`. Without it (every normal build, pinned to v0.10.0), the Setup view shows "Setting up here needs a newer Shellboy" with the manual steps (`config init`, edit, set the variable, `config check`, restart), makes no `config.get` or `connection.test` call, and never opens by itself (without `config.get` it can't know that no connection exists), and the bridge refuses the three operations.

**Deviation from the brief, and why.** The brief said to use the same `next-shellboy` feature as settings editing. `next-shellboy` builds against Shellboy main, which has no `Command::ConnectionTest`, `CredentialsSet` or `CredentialsClear` yet, and the allowlist is an exhaustive `match` over the crate's `Command`. Naming those variants under `next-shellboy` would stop that feature building today. `next-connection-setup` implies `next-shellboy` and adds only these arms and the capability; when the pin passes a Shellboy that has the operations, the feature goes and the arms stay, as `next-shellboy` does. The variant names are guessed from the wire names and were **not compiled** (no Shellboy has them).

## Allowlist

`connection.test` is a read; `credentials.set` and `credentials.clear` are mutations. A decode failure of any of the three, or of `credentials.*`, never repeats the arguments in its error (serde can quote a value), tested in `src/ws.rs`. The bridge keeps no log of call arguments. The debug page logs frames a developer types into it: that is its job, and it is off unless enabled.

## What the browser does with the key

The key is typed in a password field with `autocomplete="off"`. At Test it is copied into the setup object, the field is emptied at once, and the screen says a key was entered and isn't shown again. The copy lives in memory until the save sends it in `credentials.set`, and is dropped after the save, after a rejected key, on changing service, or on leaving the screen. It is never in a signal, in preferences (`loadPrefs`/`savePrefs` hold design, theme, language and weights), in `localStorage`, in the URL, in an error message or in a log. Tests check all of these (`ui-core/test/setup.test.ts`, the Setup smoke test).

## Assumed wire shape (to correct in `web/data/src/connection-setup.ts`)

| Operation | Arguments | Result |
|---|---|---|
| `connection.test` | `{connection}` for a saved one, or `{base_url, api, api_key_env?, api_key_header?, api_key?}` as flat fields | `{http_status?, models: string[] or {id}[], api_key_env?: {name, set}, failure?: null or {class, message?}}`; a failed provider reply is a result, not an error response |
| `credentials.set` | `{connection, value}` | `{path?}` |
| `credentials.clear` | `{connection}` | `{}` (decoded, not used by a screen yet) |
| `config.set` | the existing shape with `expected_hash` and `changes` of dotted fields | `restart_required` as today |

Failure classes the adapter knows: `auth`, `url`, `unreachable`, `timeout`, `tls`, `rate_limit`, `server`; anything else is `other`. A candidate with both `api_key_env` and `api_key` is never sent: a typed key goes alone so the test is about that key.

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Presets' key pages are `console.anthropic.com/settings/keys` and `platform.openai.com/api-keys` | the addresses the providers' own documentation gave when read; not fetched now | a link is found dead |
| Local and Other default to `chat_completions`; Local's example is `http://localhost:11434/v1` | the dialect most servers (Ollama, LiteLLM, vLLM) speak; Ollama's default port. Shellboy's docs name no local preset | a local server needs another dialect |
| `api_key_env` is always written for a preset with a variable name, also when the key is stored | `api_key_header` requires `api_key_env` in Shellboy's validation, and a stored key is the fallback behind it (#269 stage A) | the core stores a key without a variable |
| It sets the default connection and model | the screen exists to reach a first message; saying so beside the Save button | a second service is added from Settings and the person wants to keep the old default |
| The key is held in memory from Test to Save rather than stored at Test | an untested key shouldn't be written to `credentials.toml`, and `connection.test` accepts a candidate with the key | the core can test a stored candidate |
| A connection change needs a restart where the owner says so; no restart automation | #269 stage C changes this; the screen follows `restart_required` | stage C lands |
| Not shown automatically on an owner without the capability | without `config.get` the screen can't know there is no connection | the owner reports connections some other way |

OpenRouter and LiteLLM proxy are presets because they are common entry points and a preset is only data. OpenRouter's fixed address and key page, and LiteLLM's example port and variable name, come from memory and still need checking against their documentation. A provider may serve its model list without checking the key, so a fetched list is never reported as an accepted key; if OpenRouter behaves this way, the first message is the real check.
