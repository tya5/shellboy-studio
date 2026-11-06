// Live model text preview (core stage E3). Not on Shellboy main yet.
//
// What is known: the browser `stream` frame {thread_id, cursor, text, gap} (envelope.rs),
// documented as "model text since the last frame, bounded, lossy with an explicit gap".
// What is NOT known: how the owner wire names attempts, the Thread-missing case, baseline
// and resync_required inside the `events.wait` result, and what the bridge forwards of
// them. The client rules below are therefore split:
//
//  * implemented against the browser frame: discard on `gap: true`, on resync, owner
//    restart/unreachable, socket close, and on exceeding MAX_PREVIEW_CHARS;
//  * `discardPreview(reason)` accepts the owner-wire reasons (`new_attempt`,
//    `missing_from_live_text`, `baseline`, `resync_required`) so the day the wire is known
//    the adapter only has to call it; detecting them is `applyOwnerLiveText`, a stub that
//    throws.
//
// After any discard a preview stays discarded (saved output is shown) and later frames are
// ignored: cursors are opaque, so a frame after a discard cannot be told from the middle of
// the same attempt. Resuming needs the owner's attempt boundary (see the stub).

export type PreviewDiscardReason =
  | "gap"
  | "resync"
  | "owner_restarted"
  | "owner_unreachable"
  | "connection_closed"
  | "overflow"
  // owner-wire reasons (detection not implemented; see applyOwnerLiveText)
  | "new_attempt"
  | "missing_from_live_text"
  | "baseline"
  | "resync_required";

export type Preview =
  | { kind: "none"; discarded?: PreviewDiscardReason }
  | { kind: "live"; text: string; cursor: string };

/** Longest preview kept, in UTF-16 code units. A limit; exceeding it discards the preview. */
export const MAX_PREVIEW_CHARS = 262144;

export const NO_PREVIEW: Preview = { kind: "none" };

export function discardPreview(reason: PreviewDiscardReason): Preview {
  return { kind: "none", discarded: reason };
}

export function applyStream(
  current: Preview,
  frame: { text: string; cursor: string; gap: boolean },
): Preview {
  if (current.kind === "none" && current.discarded) return current;
  if (frame.gap) return discardPreview("gap");
  const text = (current.kind === "live" ? current.text : "") + frame.text;
  if (text.length > MAX_PREVIEW_CHARS) return discardPreview("overflow");
  return { kind: "live", text, cursor: frame.cursor };
}

export class LiveTextWireUnknownError extends Error {
  constructor() {
    super(
      "live text owner wire (core stage E3) is not defined yet: attempt_id, live_text " +
        "membership, baseline and resync_required handling cannot be implemented without it",
    );
    this.name = "LiveTextWireUnknownError";
  }
}

/**
 * STUB, fails loudly on purpose. When E3 lands this decodes the owner's live-text fields
 * (new attempt_id, Thread missing from live_text, baseline, resync_required) into
 * `discardPreview(...)` calls, and signals when a new attempt may start a fresh preview.
 */
export function applyOwnerLiveText(_ownerPayload: unknown): never {
  throw new LiveTextWireUnknownError();
}
