// Core protocol 30 record-page metadata. Selectors that are not reflected are
// represented by omission flags, never reconstructed from the request.
export interface ThreadListFilters {
  order?: "updated" | "created";
  archived?: "exclude" | "include" | "only";
  state?: string | null;
  thread_ids?: string[] | null;
  query_omitted?: boolean;
  tags_omitted?: boolean;
  cwd_omitted?: boolean;
  awaiting_omitted?: boolean;
}
export type NameListFilters = Record<string, never>;
export interface ThreadScopeFilter { thread_id: string }
export interface ArtifactScopeFilter { artifact_id: string }
export interface MessageListFilters {
  owed_by_thread_id?: string | null;
  asked_by_thread_id?: string | null;
  to_omitted?: boolean;
}
export interface HistoryListFilters extends ThreadScopeFilter {
  run_id?: string | null;
  since?: string | null;
  shell_state?: string | null;
  excerpt_chars: number;
}
export interface RelationListFilters { node_id: string; relation: string }
export interface ShellListFilters {
  thread_id?: string | null;
  state?: string | null;
  exit_code?: number | null;
  since?: string | null;
  until?: string | null;
  command_contains_omitted?: boolean;
}
export interface CompactListFilters extends ThreadScopeFilter { since?: string | null; until?: string | null }
export interface StatusFilters {
  all: boolean;
  thread_id?: string | null;
  run_id?: string | null;
  state: string[];
  since?: string | null;
}

const object = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const string = (x: unknown) => typeof x === "string";
const bool = (x: unknown) => typeof x === "boolean";
const integer = (x: unknown) => Number.isSafeInteger(x);
const strings = (x: unknown) => Array.isArray(x) && x.every(string);
const nullable = (check: Check): Check => x => x === null || check(x);
const oneOf = (...values: string[]): Check => x => typeof x === "string" && values.includes(x);
type Check = (x: unknown) => boolean;
function fields(required: Record<string, Check>, optional: Record<string, Check> = {}) {
  return (x: unknown) => object(x) && Object.entries(required).every(([k, check]) => check(x[k]))
    && Object.entries(x).every(([k, v]) => (required[k] ?? optional[k])?.(v) === true);
}
export const recordFilters = {
  threads: fields({}, { order: oneOf("updated", "created"), archived: oneOf("exclude", "include", "only"), state: nullable(string), thread_ids: nullable(strings), query_omitted: bool, tags_omitted: bool, cwd_omitted: bool, awaiting_omitted: bool }),
  names: fields({}),
  thread: (id: string) => fields({ thread_id: x => x === id }),
  artifact: (id: string) => fields({ artifact_id: x => x === id }),
  messages: fields({}, { owed_by_thread_id: nullable(string), asked_by_thread_id: nullable(string), to_omitted: bool }),
  shells: fields({}, { thread_id: nullable(string), state: nullable(string), exit_code: nullable(integer), since: nullable(string), until: nullable(string), command_contains_omitted: bool }),
  status: fields({ all: bool, state: strings }, { thread_id: nullable(string), run_id: nullable(string), since: nullable(string) }),
  compactions: (id: string) => fields({ thread_id: x => x === id }, { since: nullable(string), until: nullable(string) }),
};

export function validPageFacts(raw: Record<string, unknown>, validate: Check): boolean {
  return Number.isSafeInteger(raw.limit) && (raw.limit as number) > 0 && validate(raw.filters);
}
