import { signal } from "@preact/signals-core";
import { readConfigFacts } from "./config";
import type { Operations } from "../../data/src";

/** One serialized writer. Re-reads the hash and preserves every unrelated path. */
export class GuideRegistration {
  readonly state = signal<{ supported: boolean; registered: boolean; busy: boolean; error?: string; applied?: boolean; restart?: boolean }>({ supported: false, registered: false, busy: false });
  private generation = 0;
  private running = false;
  private desired: { path: string; enabled: boolean } | undefined;
  constructor(private ops: Operations) {}
  update(dir: string | undefined, enabled: boolean): void {
    if (!dir) return;
    const path = `${dir.replace(/[\\/]+$/, "")}/studio/agent-pointer.md`;
    this.desired = { path, enabled }; this.generation++;
    if (!this.running) void this.run();
  }
  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.desired) {
        const desired = this.desired; const generation = this.generation; this.desired = undefined;
        this.state.value = { ...this.state.peek(), busy: true, error: undefined };
        const read = await this.ops.configGet();
        if (generation !== this.generation) continue;
        if (!read.ok) { this.state.value = { supported: false, registered: false, busy: false }; continue; }
        const facts = readConfigFacts(read.value); const list = facts.file.values?.extra_instructions;
        if (!facts.file.valid || !Array.isArray(list) || !list.every((x) => typeof x === "string") || !facts.file.contentHash) { this.state.value = { supported: false, registered: false, busy: false }; continue; }
        const registered = list.includes(desired.path);
        if (registered === desired.enabled) { this.state.value = { supported: true, registered, busy: false }; continue; }
        const next = desired.enabled ? [...list, desired.path] : list.filter((x) => x !== desired.path);
        const result = await this.ops.configSet(facts.file.contentHash, [{ field: "extra_instructions", value: next }]);
        if (!result.ok) { this.state.value = { supported: true, registered, busy: false, error: result.error.message }; continue; }
        this.state.value = { supported: true, registered: desired.enabled, busy: false, applied: result.value.applied_to_running_owner === true, restart: result.value.restart_required === true };
      }
    } finally { this.running = false; }
  }
}
