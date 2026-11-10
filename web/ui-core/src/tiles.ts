// Visible tile previews: bounded queue and reads, cancelled on hints or removal.
import { signal } from "@preact/signals-core";
import { Cancel, CAPABILITY_HISTORY_WINDOW, type Handle, type ShellboyData } from "../../data/src";
import { materializeHistoryPresentation, type ConversationRow } from "./conversation";

export const TILE_LIMIT = 20;
export const TILE_READS = 4;
export interface TilePreview { rows: ConversationRow[]; incomplete: boolean }
export class TilePreviews {
  readonly previews = signal<ReadonlyMap<string, TilePreview>>(new Map());
  private watches = new Map<string, Handle>();
  private pending = new Set<string>();
  private running = new Map<string, Cancel>();
  private stopped = false;
  constructor(private data: ShellboyData) {}
  show(id: string): void {
    if (this.stopped || this.watches.has(id) || this.watches.size >= TILE_LIMIT || !this.data.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) return;
    this.watches.set(id, this.data.watchHints(id, () => this.refresh(id)));
    this.refresh(id);
  }
  hide(id: string): void {
    this.watches.get(id)?.close(); this.watches.delete(id);
    this.pending.delete(id); this.running.get(id)?.cancel();
    const next = new Map(this.previews.peek()); next.delete(id); this.previews.value = next;
  }
  close(): void { this.stopped = true; for (const id of [...this.watches.keys()]) this.hide(id); }
  private refresh(id: string): void {
    if (!this.watches.has(id)) return;
    this.running.get(id)?.cancel();
    this.pending.add(id); this.pump();
  }
  private pump(): void {
    while (!this.stopped && this.running.size < TILE_READS && this.pending.size) {
      const id = [...this.pending].find((key) => !this.running.has(key));
      if (!id) break;
      this.pending.delete(id);
      const cancel = new Cancel(); this.running.set(id, cancel);
      void this.read(id, cancel).finally(() => { if (this.running.get(id) === cancel) this.running.delete(id); this.pump(); });
    }
  }
  private async read(id: string, cancel: Cancel): Promise<void> {
    const history = await this.data.operations.historyWindow({ thread_id: id, before: 19, after: 0, excerpt_chars: 160 }, { cancel });
    if (cancel.cancelled || !history.ok) return;
    const shells = await this.data.operations.shellList({ thread_id: id, limit: 20 }, { cancel });
    if (cancel.cancelled || !this.watches.has(id)) return;
    const facts = new Map(shells.ok ? shells.value.items.map((s) => [s.execution_id, s]) : []);
    const rows = materializeHistoryPresentation(history.value.items, facts).rows;
    const next = new Map(this.previews.peek()); next.set(id, { rows, incomplete: !shells.ok || !!shells.value.next_cursor }); this.previews.value = next;
  }
}
