import type { AttachmentDetails, ShellboyData } from "../../data/src";
import { PageRun } from "../../data/src/page-run";

export class AttachmentSection {
  private readonly pages: PageRun<AttachmentDetails>;
  readonly state: PageRun<AttachmentDetails>["state"];

  constructor(private readonly data: ShellboyData) {
    this.pages = new PageRun(data, row => row.attachment_id, "Invalid attachment continuation");
    this.state = this.pages.state;
  }

  observe(threadId: string): () => void {
    return this.pages.observe(threadId, async (cursor, cancel) => {
      const out = await this.data.operations.attachmentList(threadId, cursor, { cancel });
      return out.ok ? { ok: true, value: { page: out.value } } : out;
    });
  }

  more(): void { this.pages.more(); }
  close(): void { this.pages.close(); }
}
