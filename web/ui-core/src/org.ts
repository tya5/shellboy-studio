// Capability gates and validation for single-Thread sidebar actions.
/** Capability advertised by bridges that support Thread reparenting. */
export const CAPABILITY_REPARENT = "thread.reparent";
/** Shellboy #222 stage 3: `thread.tag`, `thread.tags`, and `tags` / `cwd` on `thread.list`. */
export const CAPABILITY_TAGS = "thread.tags";
/** `thread.cwds`, the list of directories. Its shape is assumed to mirror `thread.tags` (see `Operations.threadCwds`). */
export const CAPABILITY_CWDS = "thread.cwds";
export const TAGS_PER_CALL = 64;
export const TAG_MAX_CHARS = 128;

export type TagInvalid = "empty" | "long" | "chars" | "both" | "many";

/** The owner's rule for a tag: trimmed, one line, 1 to 128 characters, no control characters. Case matters. */
export function checkTag(raw: string): { ok: true; tag: string } | { ok: false; invalid: TagInvalid } {
  const tag = raw.trim();
  if (tag === "") return { ok: false, invalid: "empty" };
  if ([...tag].length > TAG_MAX_CHARS) return { ok: false, invalid: "long" };
  if (/[\p{Cc}\u2028\u2029]/u.test(tag)) return { ok: false, invalid: "chars" };
  return { ok: true, tag };
}
