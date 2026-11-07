// Live model text preview (Shellboy #243 E3; events-and-external-protocol 2.5, client rule).
//
// The bridge forwards the owner's unsaved text as `live` frames (one per Thread, only what this
// tab has not seen) and `live_end` (no text is held for the Thread any more). The text is a
// lossy preview: never saved, never a source of truth, and the saved message replaces it.
//
//  * a new `attempt_id` or `gap: true` discards the preview first, then deltas are appended;
//  * offsets count Unicode scalar values of the attempt, reasoning included. A delta that starts
//    past what is held, or a preview that starts partway, is shown as incomplete, never patched;
//  * `live_end` keeps the text on screen until the saved message arrives (or a later change shows
//    none is coming), so the answer does not vanish and reappear;
//  * deltas are applied at once but published to the signal once per `schedule` tick (the app
//    passes an animation frame), so a burst of frames is one render.

import { signal, type ReadonlySignal } from "@preact/signals-core";

export type PreviewDiscardReason =
  | "gap"
  | "resync"
  | "owner_restarted"
  | "owner_unreachable"
  | "connection_closed"
  | "saved"
  | "ended";

export type Preview =
  | { kind: "none"; discarded?: PreviewDiscardReason }
  | {
      kind: "live";
      attemptId: string;
      /** Ordinary (not reasoning) text so far. */
      text: string;
      /** Text before or inside it was missed: the start, a gap, or the bound. Say so. */
      incomplete: boolean;
      /** The attempt ended; waiting for the saved message. */
      ending: boolean;
    };

export interface LiveDelta {
  offset: number;
  reasoning: boolean;
  text: string;
}

export interface LiveFrame {
  attempt_id: string;
  gap: boolean;
  deltas: LiveDelta[];
}

/** Longest preview kept, in UTF-16 code units. Past it the oldest text goes and the preview is incomplete. */
export const MAX_PREVIEW_CHARS = 262144;

export const NO_PREVIEW: Preview = { kind: "none" };

export type Schedule = (callback: () => void) => void;

/** Default tick: end of the current task burst. The app replaces it with an animation frame. */
export const microtaskSchedule: Schedule = (callback) => {
  void Promise.resolve().then(callback);
};

const scalars = (text: string): number => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};
const dropScalars = (text: string, count: number): string => Array.from(text).slice(count).join("");

export class LiveText {
  private readonly sig = signal<Preview>(NO_PREVIEW);
  readonly preview: ReadonlySignal<Preview> = this.sig;

  private attempt: string | undefined;
  private text = "";
  private end = 0;
  private started = false;
  private incomplete = false;
  private ending = false;
  private mark: string | undefined;
  private queued = false;

  /**
   * @param saved Identifies the newest saved model message of the Thread. When it differs from
   *   what it was as the attempt began, the saved message has arrived.
   */
  constructor(
    private readonly schedule: Schedule,
    private readonly saved: () => string | undefined,
  ) {}

  /** A `live` frame. */
  apply(frame: LiveFrame): void {
    if (frame.attempt_id !== this.attempt || frame.gap) {
      this.attempt = frame.attempt_id;
      this.text = "";
      this.end = 0;
      this.started = false;
      this.incomplete = frame.gap;
      this.ending = false;
      this.mark = this.saved();
    }
    for (const d of frame.deltas) {
      const length = scalars(d.text);
      if (this.started && d.offset + length <= this.end) continue; // already held
      let text = d.text;
      if (!this.started) {
        if (d.offset > 0) this.incomplete = true;
      } else if (d.offset > this.end) {
        this.incomplete = true;
      } else if (d.offset < this.end) {
        text = dropScalars(text, this.end - d.offset);
      }
      this.started = true;
      this.end = d.offset + length;
      if (!d.reasoning) this.text += text;
    }
    if (this.text.length > MAX_PREVIEW_CHARS) {
      let cut = this.text.slice(this.text.length - MAX_PREVIEW_CHARS);
      const first = cut.charCodeAt(0);
      if (first >= 0xdc00 && first <= 0xdfff) cut = cut.slice(1); // never start inside a pair
      this.text = cut;
      this.incomplete = true;
    }
    this.ending = false;
    this.publishLater();
  }

  /** A `live_end` frame: no text is held. Keep what is shown until the saved message arrives. */
  finish(): void {
    if (this.attempt === undefined) return;
    this.ending = true;
    this.publishNow();
    this.checkSaved();
  }

  /** Whether the preview waits for the saved message. */
  get isEnding(): boolean {
    return this.attempt !== undefined && this.ending;
  }

  /** The history changed (or was read): is the saved message there? */
  checkSaved(): void {
    if (this.isEnding && this.saved() !== this.mark) this.discard("saved");
  }

  /** A read after the end finished and no saved message came (stopped, failed): nothing is coming. */
  endedWithoutSaved(): void {
    if (this.isEnding) this.discard("ended");
  }

  discard(reason: PreviewDiscardReason): void {
    this.attempt = undefined;
    this.text = "";
    this.end = 0;
    this.started = false;
    this.incomplete = false;
    this.ending = false;
    this.sig.value = { kind: "none", discarded: reason };
  }

  private publishNow(): void {
    if (this.attempt === undefined) return;
    this.sig.value = {
      kind: "live",
      attemptId: this.attempt,
      text: this.text,
      incomplete: this.incomplete,
      ending: this.ending,
    };
  }

  private publishLater(): void {
    if (this.queued) return;
    this.queued = true;
    this.schedule(() => {
      this.queued = false;
      this.publishNow();
    });
  }
}
