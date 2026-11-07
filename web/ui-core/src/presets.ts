// Services the first-run screen offers, as plain data. Shellboy's core holds no product knowledge
// (Shellboy #269): URLs, dialects and key pages belong here. Checked against Shellboy
// `docs/guides/configuration.md` and `config.example.toml` on 2026-11-07: dialect names are
// `responses`, `chat_completions` and `anthropic_messages`; Anthropic's native API uses
// `api_key_header = "x-api-key"` and `api_key_env = "ANTHROPIC_API_KEY"`.
import type { Dialect } from "../../data/src";
import type { Lang } from "./i18n";

export type ServiceId = "anthropic" | "openai" | "openrouter" | "litellm" | "local" | "other";

export interface ServicePreset {
  id: ServiceId;
  label: Record<Lang, string>;
  /** Name of the connection written to `config.toml`. */
  connectionName: string;
  /** The starting address, which the person can change. */
  baseUrl: string;
  api: Dialect;
  /** Header the key goes in when it isn't `Authorization: Bearer`. */
  apiKeyHeader?: string;
  /** The page where a person creates an API key. */
  keyPageUrl?: string;
  /** The variable the connection reads. A stored key is its fallback. */
  envName?: string;
  /** False: no key is asked for. */
  needsKey: boolean;
  /** The address needs the person's confirmation up front. Every preset's address and format can be changed. */
  askUrl: boolean;
  /** The format needs the person's choice up front. */
  askDialect: boolean;
  /** Its model list answers without checking the key (OpenRouter: HTTP 200 with no key, measured 2026-11-07). */
  listSkipsKey?: boolean;
}

export const OLLAMA_CONTEXT_URL = "https://docs.ollama.com/context-length";

export const SERVICES: readonly ServicePreset[] = [
  {
    id: "anthropic",
    label: { en: "Anthropic", ja: "Anthropic" },
    connectionName: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic_messages",
    apiKeyHeader: "x-api-key",
    keyPageUrl: "https://console.anthropic.com/settings/keys",
    envName: "ANTHROPIC_API_KEY",
    needsKey: true,
    askUrl: false,
    askDialect: false,
  },
  {
    id: "openai",
    label: { en: "OpenAI", ja: "OpenAI" },
    connectionName: "openai",
    baseUrl: "https://api.openai.com/v1",
    api: "responses",
    keyPageUrl: "https://platform.openai.com/api-keys",
    envName: "OPENAI_API_KEY",
    needsKey: true,
    askUrl: false,
    askDialect: false,
  },
  {
    id: "openrouter",
    label: { en: "OpenRouter", ja: "OpenRouter" },
    connectionName: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "chat_completions",
    keyPageUrl: "https://openrouter.ai/keys",
    envName: "OPENROUTER_API_KEY",
    listSkipsKey: true,
    needsKey: true,
    askUrl: false,
    askDialect: false,
  },
  {
    id: "litellm",
    label: { en: "LiteLLM proxy", ja: "LiteLLM プロキシ" },
    connectionName: "litellm",
    // LiteLLM's default port, shown as an example. A proxy offers either dialect.
    baseUrl: "http://localhost:4000/v1",
    api: "chat_completions",
    envName: "LITELLM_API_KEY",
    needsKey: true,
    askUrl: true,
    askDialect: true,
  },
  {
    id: "local",
    label: { en: "Local", ja: "ローカル" },
    connectionName: "local",
    // Ollama's default address, shown as an example. Nothing probes ports.
    baseUrl: "http://localhost:11434/v1",
    api: "chat_completions",
    needsKey: false,
    askUrl: true,
    askDialect: false,
  },
  {
    id: "other",
    label: { en: "Other", ja: "その他" },
    connectionName: "custom",
    baseUrl: "",
    api: "chat_completions",
    envName: "SHELLBOY_API_KEY",
    needsKey: true,
    askUrl: true,
    askDialect: true,
  },
];

export const DIALECTS: readonly Dialect[] = ["responses", "chat_completions", "anthropic_messages"];

export const presetOf = (id: ServiceId): ServicePreset => SERVICES.find((s) => s.id === id)!;
