import { PageRun } from "./page-run";
import type { ArtifactSummary, ArtifactVersionStamp } from "./protocol";
import type { ShellboyData } from "./store";

export class ArtifactObservation {
  readonly list: PageRun<ArtifactSummary>;
  readonly history: PageRun<ArtifactVersionStamp, ArtifactSummary>;

  constructor(private readonly data: ShellboyData) {
    this.list = new PageRun(data, row => row.artifact_id, "Invalid artifact continuation");
    this.history = new PageRun(data, row => row.version, "Invalid artifact version continuation");
  }

  observeList(thread: string): () => void {
    return this.list.observe(thread, async (cursor, cancel) => {
      const out = await this.data.operations.artifactList(thread, cursor, { cancel });
      return out.ok ? { ok: true, value: { page: out.value } } : out;
    });
  }

  observeHistory(thread: string, artifact: string): () => void {
    return this.history.observe(thread, async (cursor, cancel) => {
      const out = await this.data.operations.artifactHistory(thread, artifact, cursor, { cancel });
      if (!out.ok) return out;
      const { versions: page, ...header } = out.value;
      return { ok: true, value: { page, header } };
    });
  }

  close(): void { this.list.close(); this.history.close(); }
}

export const CAPABILITY_ARTIFACTS = "artifact.list.page";

export interface ArtifactContentTarget { thread_id: string; artifact_id: string; version: number }

/** The bridge resolves this key against the owner; this call never accepts a path. */
export function artifactContent(target: ArtifactContentTarget, action: "preview" | "open", signal?: AbortSignal): Promise<Response> {
  return fetch("/artifact-content", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, action }),
  });
}
