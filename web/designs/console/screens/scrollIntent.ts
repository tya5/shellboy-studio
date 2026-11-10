/** Keep an upward gesture detached until the user returns to the actual end. */
export class ScrollIntent {
  following = true;
  private top = 0;
  private programTop: number | undefined;
  program(box: HTMLElement, top: number): void {
    const bounded = Math.min(Math.max(0, top), Math.max(0, box.scrollHeight - box.clientHeight));
    if (box.scrollTop !== bounded) box.scrollTop = bounded;
    this.top = box.scrollTop;
    this.programTop = box.scrollTop;
    this.height = box.scrollHeight;
    this.viewport = box.clientHeight;
  }
  private height: number | undefined;
  private viewport: number | undefined;
  private upward = false;
  private touchY: number | undefined;
  touchStart(y: number): void { this.touchY = y; }
  touchMove(y: number): void {
    if (this.touchY !== undefined && y > this.touchY) this.upward = true;
    this.touchY = y;
  }
  key(key: string): void { this.upward = ["PageUp", "Home", "ArrowUp"].includes(key); }
  wheel(deltaY: number): void { this.upward = deltaY < 0; }
  scroll(box: HTMLElement): boolean {
    const top = box.scrollTop;
    const resized = this.height !== box.scrollHeight || this.viewport !== box.clientHeight;
    this.height = box.scrollHeight;
    this.viewport = box.clientHeight;
    if (box.scrollHeight <= box.clientHeight) {
      this.following = true;
      this.programTop = undefined;
      this.top = top;
      return true;
    }
    if (this.programTop !== undefined && Math.abs(top - this.programTop) < 1) {
      this.programTop = undefined;
      this.top = top;
      return this.following;
    }
    this.programTop = undefined;
    if (top < this.top && (!resized || this.upward)) this.following = false;
    else if (top > this.top && !resized && box.scrollHeight - top - box.clientHeight <= 1) this.following = true;
    this.top = top;
    this.upward = false;
    return this.following;
  }
}

/** Capture a tool heading before its details change, then restore its viewport position. */
export interface HeadingCorrection {
  readonly identity: object;
  readonly delta: number;
}

export class HeadingAnchor {
  private saved: { heading: HTMLElement; top: number; identity: object } | undefined;
  capture(heading: HTMLElement): void {
    this.saved = { heading, top: heading.getBoundingClientRect().top, identity: {} };
  }
  peek(): HeadingCorrection | undefined {
    const saved = this.saved;
    if (!saved?.heading.isConnected) return;
    const delta = saved.heading.getBoundingClientRect().top - saved.top;
    if (saved !== this.saved) return;
    return Object.freeze({ identity: saved.identity, delta });
  }
  consume(plan: HeadingCorrection): boolean {
    if (this.saved?.identity !== plan.identity || !this.saved.heading.isConnected) return false;
    this.saved = undefined;
    return true;
  }
  clear(): void { this.saved = undefined; }
  /** Compatibility for the legacy writer; generation-aware sync uses peek/consume. */
  correction(): number | undefined {
    const saved = this.saved;
    this.saved = undefined;
    return saved?.heading.isConnected ? saved.heading.getBoundingClientRect().top - saved.top : undefined;
  }
}

/** A measured DOM anchor survives regrouping when an adjacent window extends a tool run. */
export interface ReadingContext {
  readonly revision: string | number | undefined;
  readonly epoch: number;
  readonly capability: object;
  readonly nodes: readonly string[];
  isCurrent(): boolean;
}

/** Resolve visible geometry from canonical identity, never retain item DOM nodes. */
function canonicalElement(item: HTMLElement): HTMLElement | undefined {
  if (item.closest('[data-live-overlay], .live-tail, [hidden]')) return;
  const group = item.closest<HTMLElement>('[data-work-group]');
  if (!group) return item;
  let members: unknown;
  try { members = JSON.parse(group.dataset.headingMemberKeys ?? 'null'); } catch { return; }
  if (!Array.isArray(members) || members.some(key => typeof key !== 'string') || new Set(members).size !== members.length || !members.includes(item.dataset.itemKey)) return;
  const actual = [...group.querySelectorAll<HTMLElement>('[data-item-key]')].filter(el => !el.closest('[data-live-overlay], .live-tail'));
  if (actual.length !== members.length || actual.some((el, index) => el.closest('[data-work-group]') !== group || el.dataset.itemKey !== members[index])) return;
  if (group.tagName !== 'DETAILS') return;
  return group.hasAttribute('open') ? item : group.querySelector<HTMLElement>(':scope > summary[data-work-heading]') ?? undefined;
}

export class ReadingAnchor {
  private canonical: { key: string; node: string; offset: number; revision: string | number | undefined; epoch: number; capability: object } | undefined;

  private saved: { node: string; step?: string; members: string[]; offset: number } | undefined;
  capture(box: HTMLElement, context?: ReadingContext): void {
    this.canonical = undefined;
    const parent = box.querySelector('.conversation-items');
    if (parent) {
      this.saved = undefined;
      if (!context?.isCurrent() || context.revision === undefined) return;
      const items = [...parent.querySelectorAll<HTMLElement>('[data-item-key]')].filter(item => !item.closest('[data-live-overlay], .live-tail'));
      const keys = new Set<string>();
      for (const item of items) {
        const key = item.dataset.itemKey;
        if (!key || keys.has(key) || !item.dataset.node || !context.nodes.includes(item.dataset.node)) return;
        keys.add(key);
      }
      const top = box.getBoundingClientRect().top;
      for (const item of items) {
        const element = canonicalElement(item);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= top) continue;
        if (!context.isCurrent()) return;
        this.canonical = { key: item.dataset.itemKey!, node: item.dataset.node!, offset: rect.top - top, revision: context.revision, epoch: context.epoch, capability: context.capability };
        return;
      }
      return;
    }
    const top = box.getBoundingClientRect().top;
    const row = [...box.querySelectorAll<HTMLElement>(".vrow[data-node]")]
      .find((el) => el.getBoundingClientRect().bottom > top && el.getBoundingClientRect().height > 0);
    if (!row) { this.saved = undefined; return; }
    const step = [...row.querySelectorAll<HTMLElement>("[data-scroll-key]")]
      .find((el) => el.getBoundingClientRect().bottom > top);
    this.saved = { node: row.dataset.node!, step: step?.dataset.scrollKey,
      members: JSON.parse(row.dataset.members ?? "[]") as string[],
      offset: (step ?? row).getBoundingClientRect().top - top };
  }
  correction(box: HTMLElement, context?: ReadingContext): number | undefined {
    const canonical = this.canonical;
    if (canonical) {
      if (!context?.isCurrent() || context.revision !== canonical.revision || context.epoch !== canonical.epoch || context.capability !== canonical.capability || !context.nodes.includes(canonical.node)) { this.canonical = undefined; return; }
      const items = [...box.querySelectorAll<HTMLElement>('.conversation-items [data-item-key]')].filter(item => !item.closest('[data-live-overlay], .live-tail'));
      const keys = new Set<string>();
      for (const item of items) {
        const key = item.dataset.itemKey;
        if (!key || keys.has(key) || !item.dataset.node || !context.nodes.includes(item.dataset.node)) return;
        keys.add(key);
      }
      const matches = items.filter(item => item.dataset.itemKey === canonical.key);
      if (matches.length !== 1 || matches[0]!.dataset.node !== canonical.node) return;
      const element = canonicalElement(matches[0]!);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) return;
      const delta = rect.top - box.getBoundingClientRect().top - canonical.offset;
      return context.isCurrent() ? delta : undefined;
    }
    const saved = this.saved;
    if (!saved) return;
    const rows = [...box.querySelectorAll<HTMLElement>(".vrow[data-node]")];
    const step = saved.step === undefined ? undefined : [...box.querySelectorAll<HTMLElement>("[data-scroll-key]")]
      .find((el) => el.dataset.scrollKey === saved.step);
    const members = new Set(saved.members);
    const row = rows.find((el) => el.dataset.node === saved.node) ?? (members.size ? rows.find((el) =>
      (JSON.parse(el.dataset.members ?? "[]") as string[]).some((member) => members.has(member))) : undefined);
    const element = step ?? row;
    if (element) return element.getBoundingClientRect().top - box.getBoundingClientRect().top - saved.offset;
  }
}
