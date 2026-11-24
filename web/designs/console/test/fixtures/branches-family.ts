// Synthetic Thread family for the Branches screen (#138): the approved mock's three lines of work, shaped as a
// real owner returns `thread.branches`, `history.window`, `thread.rewind` and `thread.fork`. Examples, not data.
import { summary, type FakeOwnerDb } from "../../../../data/test/harness";

type Node = { node_id: string; kind: string; excerpt: string };
const you = (id: string, excerpt: string): Node => ({ node_id: id, kind: "user", excerpt });
const bot = (id: string, excerpt: string): Node => ({ node_id: id, kind: "assistant_response", excerpt });

const shared: Node[] = [
  you("r1", "Draft the v0.15 release notes from the changelog."),
  bot("r2", "Read the changelog: 31 entries since v0.14."),
  you("r3", "Group them by area."),
  bot("r4", "Grouped into Core, Studio and docs."),
  you("r5", "Which ones are user visible?"),
  you("r6", "Compare provider behavior before writing."),
];
const releaseOwn: Node[] = [
  you("r7", "Keep the stable renderer and list the fixes."),
  bot("r8", "Kept it. 12 fixes drafted under Fixed."),
  you("r9", "Add the upgrade notes."),
  bot("r10", "Upgrade notes added."),
  you("r11", "Shorten the intro."),
  bot("r12", "Intro is two sentences now."),
  you("r13", "Lint the notes and fix the headings."),
  bot("r14", "Notes are done and linted. Ready to tag."),
];
const streamOwn: Node[] = [
  you("s7", "Try streaming output for long answers."),
  bot("s8", "Prototype streams chunks as they arrive."),
  you("s9", "What happens on a retry?"),
  bot("s10", "Retries drop the chunks already shown."),
  you("s11", "Keep it behind a flag for now."),
  bot("s12", "Merged behind --stream. Retry gap noted."),
];
const retryOwn: Node[] = [
  you("t11", "Add retry with backoff and replay the chunks."),
  bot("t12", "Retry test fails on a timeout."),
];

const AT = "2026-11-07T10:16:00.000000+00:00";
const tip = (nodes: Node[], at = AT) => {
  const last = nodes.at(-1)!;
  const request = [...nodes].reverse().find((n) => n.kind === "user")!;
  return { at, node_id: last.node_id, last_request: { node_id: request.node_id, text: request.excerpt, truncated: false } };
};

export interface BranchesFixture {
  /** Paths by Thread; edit them, then call `bump` to make the next read see a new family. */
  paths: Record<string, Node[]>;
  extra: { thread_id: string; parent: string; at: string; title: string }[];
  /** Mutable owner title facts used by the production-hint browser witness. */
  titles: Record<string, string>;
  forks: number;
  append(threadId: string, node: Node): void;
}

export function branchesFamily(db: FakeOwnerDb, options: { running?: boolean } = {}): BranchesFixture {
  const fixture: BranchesFixture = {
    paths: {
      rel: [...shared, ...releaseOwn],
      stream: [...shared, ...streamOwn],
      retry: [...shared, ...streamOwn.slice(0, 4), ...retryOwn],
    },
    extra: [],
    titles: {},
    forks: 0,
    append(threadId, node) { this.paths[threadId]!.push(node); },
  };
  db.threads.rel = summary("rel", { title: "Release notes", state: "idle", activity: "idle", updated_at: AT });
  db.threads.stream = summary("stream", { title: "Streaming output", parent_id: "rel", state: options.running === false ? "idle" : "running", activity: "tools", updated_at: AT });
  db.threads.retry = summary("retry", { title: "Streaming + retry", parent_id: "stream", state: "idle", activity: "idle", updated_at: AT });
  const item = (id: string, title: string, parent: string | null, split: string | null, extra: Record<string, unknown> = {}) => {
    const path = fixture.paths[id]!;
    const ordinal = split ? path.findIndex((n) => n.node_id === split) : -1;
    return {
      depth: parent ? (parent === "rel" ? 1 : 2) : 0,
      divergence: split ? { node_id: split, ordinal, parent_continues: true, request: { node_id: split, text: path[ordinal]!.excerpt, truncated: false } } : null,
      divergence_unknown: null,
      parent_thread_id: parent,
      pruned_originals: false,
      running: false,
      size: { bytes: null, nodes_after_divergence: split ? path.length - ordinal - 1 : null, path_nodes: path.length },
      state: id === "rel" ? "current" : "branch",
      thread_id: id,
      tip: tip(path),
      title,
      ...extra,
    };
  };
  const answer = db.answer.bind(db);
  db.answer = (call) => {
    const a = (call.args ?? {}) as Record<string, unknown>;
    if (call.command === "thread.branches") return { ok: true, result: {
      ancestors_truncated: false, family_threads: 3 + fixture.extra.length, family_truncated: false, root_parent_unavailable: false, root_thread_id: "rel", thread_id: a.thread_id,
      limits: { ancestors: 32, bytes: "not_measured", excerpt_chars: 160, family_threads: 256, request_scan_rows: 256 },
      items: [
        item("rel", fixture.titles.rel ?? "Release notes", null, null),
        item("stream", "Streaming output", "rel", "r6", { running: options.running !== false }),
        item("retry", "Streaming + retry", "stream", "s10"),
        ...fixture.extra.map((x) => item(x.thread_id, x.title, x.parent, x.at)),
      ],
    } };
    if (call.command === "history.window") {
      const id = String(a.thread_id);
      const path = fixture.paths[id];
      if (!path) return { ok: false, code: "thread_not_found" };
      const at = typeof a.node_id === "string" ? path.findIndex((n) => n.node_id === a.node_id) : typeof a.ordinal === "number" ? a.ordinal : path.length - 1;
      if (at < 0 || at >= path.length) return { ok: false, code: "cursor_expired" };
      if (typeof a.expect_node_id === "string" && path[at]?.node_id !== a.expect_node_id) return { ok: false, code: "cursor_expired" };
      const first = Math.max(0, at - Number(a.before ?? 20));
      const last = Math.min(path.length - 1, at + Number(a.after ?? 20));
      return { ok: true, result: { thread_id: id, revision: path.length, total: path.length, items: path.slice(first, last + 1).map((n, k) => ({ ...n, execution_count: 0, selection: { ordinal: first + k } })) } };
    }
    if (call.command === "thread.rewind") {
      const id = String(a.thread_id);
      const path = fixture.paths[id]!;
      const at = path.findIndex((n) => n.node_id === a.node_id);
      const removed = path.length - at - 1;
      const facts = {
        attachment_selections_removed: 0, child_threads_after_node: { count: 0, items: [], truncated: false }, dry_run: a.dry_run === true, node_id: a.node_id,
        note: "Conversation only: shell side effects are not undone.", path_nodes: { after: at + 1, before: path.length },
        pending_replies_to_sent_messages: { count: 0, items: [], truncated: false }, previous_end_node_id: path.at(-1)!.node_id,
        removed: { nodes: removed, turns: Math.ceil(removed / 2) }, rewound_into_summarized_range: false,
        shell_executions_after_node: { count: 2, items: [{ execution_id: "e1", command_excerpt: "./scripts/lint-notes" }, { execution_id: "e2", command_excerpt: "git commit -am notes" }], truncated: false },
        thread_id: id, title: db.threads[id]?.title, undo: "a real rewind keeps the removed part as a branch Thread you can open",
      };
      if (a.dry_run) return { ok: true, result: facts };
      const kept = `${id}-rewound`;
      fixture.paths[kept] = [...path];
      fixture.extra.push({ thread_id: kept, parent: id, at: String(a.node_id), title: `${db.threads[id]?.title} · rewound` });
      fixture.paths[id] = path.slice(0, at + 1);
      return { ok: true, result: { ...facts, branch_thread_id: kept } };
    }
    if (call.command === "thread.fork") {
      const id = String(a.thread_id);
      const path = fixture.paths[id]!;
      const at = path.findIndex((n) => n.node_id === a.node_id);
      const child = `fork-${++fixture.forks}`;
      fixture.paths[child] = path.slice(0, at + 1);
      fixture.extra.push({ thread_id: child, parent: id, at: String(a.node_id), title: `New branch ${fixture.forks}` });
      return { ok: true, result: { thread_id: child, title: `New branch ${fixture.forks}`, cwd: "/", connection: "c", model: "m", shells_count: 0, parent_id: id } };
    }
    if (call.command === "message.send") {
      const id = String(a.thread_id);
      fixture.paths[id]?.push({ node_id: `${id}-m${fixture.paths[id]!.length + 1}`, kind: "user", excerpt: String(a.text) });
      return { ok: true, result: { message_id: `${id}-message`, thread_id: id } };
    }
    return answer(call);
  };
  return fixture;
}
