import { PageRun } from "./page-run";
import type { PendingReply } from "./protocol";
import type { ShellboyData } from "./store";

export type ReplySide = "owed_by" | "asked_by";
/** Rows retained per directional reply list, and for the human inbox. */
export const REPLY_RETENTION = 128;

/** Bind both directions for the selected Thread to the shared page owner. */
export class ReplyPages {
  private readonly runs: Record<ReplySide, PageRun<PendingReply>>;
  readonly owed_by: PageRun<PendingReply>["state"];
  readonly asked_by: PageRun<PendingReply>["state"];

  constructor(private readonly data: ShellboyData) {
    const pages = () => new PageRun(data, (row: PendingReply) => row.message_id, "Invalid reply continuation", REPLY_RETENTION);
    this.runs = { owed_by: pages(), asked_by: pages() };
    this.owed_by = this.runs.owed_by.state;
    this.asked_by = this.runs.asked_by.state;
  }

  observe(thread: string): () => void {
    const observeSide = (side: ReplySide) => this.runs[side].observe(thread, async (cursor, cancel) => {
      const filter = side === "owed_by" ? { owed_by: thread } : { asked_by: thread };
      const out = await this.data.operations.messageList(filter, cursor, { cancel });
      return out.ok ? { ok: true, value: { page: out.value } } : out;
    });
    const stopOwed = observeSide("owed_by");
    const stopAsked = observeSide("asked_by");
    return () => { stopOwed(); stopAsked(); };
  }

  close(): void { this.runs.owed_by.close(); this.runs.asked_by.close(); }

  more(side: ReplySide): void { this.runs[side].more(); }
}
