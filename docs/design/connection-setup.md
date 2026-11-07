# First-run connection setup

Status: implemented (2026-11-07), local only. Realises `architecture.md` §12 for the Web: someone with no connection opens Studio and reaches a first message from one screen, without editing a file. The core operations are Shellboy issue #269, on branch `issue-269/connection-setup` and in no release, so everything about their wire shape is an assumption held in one place (below).

Logic: `web/ui-core/src/setup.ts` (the steps), `embedding.ts` (the optional embeddings step), `presets.ts` (the services and what each dialect offers, plain data), wire adapter `web/data/src/connection-setup.ts`. Screens: `web/designs/console/screens/Setup.tsx` and `SetupEmbedding.tsx`, routes `#/setup` and `#/setup/embedding`.

## Flow

1. **Service**: Anthropic, OpenAI, OpenRouter, LiteLLM proxy, Local, Other. Presets are data in `presets.ts` (label, `base_url`, dialect, key page, variable name), checked against Shellboy `docs/guides/configuration.md` and `config.example.toml`: dialects `responses`, `chat_completions`, `anthropic_messages`; Anthropic's native API uses `api_key_header = "x-api-key"` and `ANTHROPIC_API_KEY`.
2. **Key or address.** For Anthropic, OpenAI and OpenRouter, choosing the service calls `connection.test` with the preset's variable name and no key. If the owner has it set, the screen offers it once ("Use it" or "Enter a key instead"); if not, a key field with a link to the provider's key page. The screen says a Claude or ChatGPT subscription is separate from API keys and an API key is required. Local shows its address as an editable example (Ollama's default) and asks for no key. Nothing probes ports. Other asks for the address and the dialect and a key.
3. **Test**: `connection.test` again with the typed key or the variable. The result is reported as facts: "The model list was fetched: N models (HTTP 200)" or the failure class with its status and a plain next step (auth, url, unreachable, timeout, tls, rate limit, server, empty list, other). It never says the key is valid. A call that couldn't run is shown as that, not as a verdict on the key.
4. **Model**: chosen from the returned list (filter when more than 50, never more than 50 drawn) or typed. Nothing is preselected. For Local, a warning sits beside the picker: Ollama's default context can be as small as 4k tokens depending on VRAM, Ollama recommends at least 64k for agents, with a link to `https://docs.ollama.com/context-length`.
5. **Save**: a connection name field (prefilled, see below), then `credentials.set` if a key was typed, `config.get` for the hash and `config.set` writing `connections.<name>.{base_url,api,api_key_env,api_key_header}` and, only when "Make this the default connection and model" is on, `default_connection` and `default_model`. The result says where the key is stored (the path the owner reports, else `credentials.toml` beside `config.toml`), that it is a plain-text file only the account can read, and whether a restart is needed, as the `config.set` result reports it (`restart_required`: true says to restart `shellboy serve`; false says the next request picks it up; absent says it wasn't reported). Then a link to Conversation and the optional embeddings step.

### Several connections

- **Name.** Prefilled with the preset's name (`litellm`); if the probe (`config.get`, read again on every visit to the screen) knows that name, with the first free one (`litellm-2`). Valid: 1 to 64 characters of `A-Z a-z 0-9 _ -`. The owner's `config.set` takes any non-empty TOML key (`fieldOf` quotes what needs it) but refuses a name that looks like a credential and anything containing `[redacted`; Studio takes only bare keys, so a name is never quoted and has no dot to confuse a dotted field, and it repeats the owner's credential heuristic (`nameProblem` in `setup.ts`, from `looks_like_credential` in Shellboy's `config_edit.rs`). A refused name blocks Save with the reason.
- **Typing a name that exists** says that saving replaces that connection's address, format and key (its other settings are kept) and Save stays disabled until "Replace NAME" is checked. Changing the name takes the check back. A replacement also removes `api_key_env` and `api_key_header` from the old table when the new one doesn't write them, because a left-over variable would win over the key just stored.
- **Default.** With no `default_connection` in the file, "Make this the default connection and model" is on and the model is required. With one, it is off, no model is asked for (the step is titled "Default" and holds only the checkbox) and neither default field is written, so adding a second connection never silently changes the default.
- Settings > Connections has "Add a connection", which opens this flow.

### Embeddings (optional)

Reached from the saved screen ("Set up embeddings" or "Skip for now") and from Settings > Embeddings & indexing. Shellboy's `[embedding]` takes `connection` and `model` together or not at all, and the connection must exist; conversations use the connection's dialect while indexing and search call `{base_url}/embeddings`. `indexing.auto_history` defaults to true, so enabling embeddings starts automatic, possibly paid indexing of newly finalized conversation text; older conversations need an explicit selection.

1. **Connection**: one of the file's connections, each with its dialect, or "Add another connection", which runs the connection flow and comes back with the new one chosen. A dialect with no Embeddings API says so instead (`DIALECT_FACTS` in `presets.ts`: `anthropic_messages` has none): "Anthropic's API has no embeddings ... choose another connection, or add one". No model-list call is made for it and Save stays disabled. An unknown dialect is left to the owner.
2. **Model**: the list comes from `connection.test {connection}`, the same model-list GET as in setup. A list can't say which models are for embeddings, so nothing is preselected or filtered by name: there is a filter box, a typed ID and the words "choose an embedding model".
3. **Turn on**: the screen states, before the button, that this starts automatic indexing of new conversation text through the service, which may cost money, that older conversations are indexed only on request and that it can be turned off. No cost is estimated. Saving is one `config.set` with `embedding.connection` and `embedding.model`, then the restart wording above. **The screen sends no embeddings request**, and no operation other than `config.get`, `connection.test` (a model-list GET) and `config.set`; a test asserts this.

**Turning off** is a `config.set` with both fields and no `value` (`config.set` removes a key whose change has no value; Shellboy `docs/design/config.md`, #266, which also says a whole table can't be removed, so the empty `[embedding]` table may stay). The screen says that search by meaning goes with it, that nothing already indexed is deleted by Studio, and that `[indexing] auto_history = false` stops only the automatic part.

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
| Presets' key pages are `platform.claude.com/settings/keys` and `platform.openai.com/api-keys` | see "Preset sources" below; the Anthropic address was changed from `console.anthropic.com` because that now answers 301 to the new one | a link is found dead |
| Local and Other default to `chat_completions`; Local's example is `http://localhost:11434/v1` | the dialect most servers (Ollama, LiteLLM, vLLM) speak; Ollama's default port. Shellboy's docs name no local preset | a local server needs another dialect |
| `api_key_env` is always written for a preset with a variable name, also when the key is stored | `api_key_header` requires `api_key_env` in Shellboy's validation, and a stored key is the fallback behind it (#269 stage A) | the core stores a key without a variable |
| It makes the new connection the default only when the file has none (the person can change it either way) | the screen exists to reach a first message, and a second connection must not silently change the default | a person asks for a different default |
| Name rules are narrower than the owner's (bare keys only) | a name never needs quoting and can't be confused with a dotted field; the owner's exact rule isn't documented beyond non-empty and the credential heuristic | the owner documents a rule, or someone needs a dot or a space |
| Embedding is a separate model (`EmbeddingSetup`) sharing the setup's file probe | it has its own choices and write, and needs the same `config.get` facts | the probe moves to the data layer |
| Embedding needs the `connection.setup` capability | it uses `connection.test` and `config.set` | the owner reports `embedding` support separately |
| The key is held in memory from Test to Save rather than stored at Test | an untested key shouldn't be written to `credentials.toml`, and `connection.test` accepts a candidate with the key | the core can test a stored candidate |
| A connection change needs a restart where the owner says so; no restart automation | #269 stage C changes this; the screen follows `restart_required` | stage C lands |
| Not shown automatically on an owner without the capability | without `config.get` the screen can't know there is no connection | the owner reports connections some other way |

OpenRouter and LiteLLM proxy are presets because they are common entry points and a preset is only data. OpenRouter's address and key page and LiteLLM's port and variable name were checked against their documentation on 2026-11-07 (see "Preset sources"). A provider may serve its model list without checking the key, so a fetched list is never reported as an accepted key; OpenRouter does (HTTP 200 with no key, measured 2026-11-07), so its screen says the first message is what checks the key.

Every preset is only a starting value. "Change address or format" opens the address and the format on any service, so a stale preset never blocks anyone and doesn't need an urgent fix. Editing them forgets what was learned about the preset's variable: the owner's key is never sent to a typed address unasked. `api_key_env` is written only when the person chose the variable, because at each request it would otherwise win over the key they stored. We add a preset only when "Other" is really a problem; models.dev (checked 2026-11-07: 235 providers, but none of Anthropic's or OpenAI's addresses, no LiteLLM or Ollama, 6 MB, dialect only implied) stays a possible search aid for "Other", not a source of truth.

## Preset sources (fetched 2026-11-07)

| Value | Result | Source |
|---|---|---|
| Anthropic key page | Changed to `https://platform.claude.com/settings/keys`. `https://console.anthropic.com/settings/keys` answers 301 with that Location. | the 301 itself; `https://platform.claude.com/docs/en/api/overview` ("generate API keys on the API keys page (`platform.claude.com/settings/keys`)") |
| Anthropic base URL, key header | Unchanged. The API is at `https://api.anthropic.com`; `GET /v1/models`; `x-api-key` is listed (as a legacy fallback to `Authorization: Bearer`, still supported). The preset's `x-api-key` therefore still works. | same overview page |
| OpenAI key page | Unchanged: `https://platform.openai.com/api-keys`. The page itself answered 403 to the fetch tool, so it was not opened. The link is quoted by OpenAI's own docs: "create an API key in the dashboard" linking to it. | `https://developers.openai.com/api/docs/libraries` (`platform.openai.com/docs/quickstart` answers 301 to `developers.openai.com/api/docs/quickstart`, which uses `OPENAI_API_KEY` and gives no key-page URL) |
| OpenAI variable | Unchanged: `OPENAI_API_KEY`. | `https://developers.openai.com/api/docs/quickstart` |
| OpenRouter base URL | Unchanged: `https://openrouter.ai/api/v1` (an EU in-region variant `https://eu.openrouter.ai/api/v1` exists for Business/Enterprise; not a preset). | `https://openrouter.ai/docs/quickstart` |
| OpenRouter key page | Unchanged: `https://openrouter.ai/keys` (the page itself is a sign-in page when signed out). | `https://openrouter.ai/docs/api-reference/authentication` |
| OpenRouter variable `OPENROUTER_API_KEY` | Not confirmed by a fetched page (the quickstart shows only the placeholder `<OPENROUTER_API_KEY>`). It is only the name Studio asks the owner to read, so it is a convention, not a provider requirement. | `https://openrouter.ai/docs/quickstart` |
| LiteLLM default port | Unchanged: 4000 ("Proxy running on http://0.0.0.0:4000"; examples use `http://localhost:4000`). The preset's `/v1` suffix is the OpenAI-compatible path and was not confirmed by this page. | `https://docs.litellm.ai/docs/proxy/quick_start` |
| LiteLLM variable `LITELLM_API_KEY` | Unchanged. The proxy's own variable is `LITELLM_MASTER_KEY` (server side); the virtual-keys page uses `LITELLM_API_KEY` for client calls (`Authorization: Bearer $LITELLM_API_KEY`). | `https://docs.litellm.ai/docs/proxy/virtual_keys` |
