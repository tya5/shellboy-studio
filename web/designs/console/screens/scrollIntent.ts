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
  readonly nodes: readonly string[] | ReadonlySet<string>;
  readonly groupMember?: (group: string, item: string, node: string, firstOnly: boolean) => boolean;
  readonly assistantAttempts?: ReadonlyMap<string, string>;
  readonly previewText?: (key: string, attempt: string) => string | undefined;
  readonly savedText?: (key: string, node: string) => string | undefined;
  isCurrent(): boolean;
}

export const localRowSelector = '[data-anchor-local], [data-live-overlay], .live-tail';

/** Resolve visible geometry from canonical identity, never retain item DOM nodes. */
function canonicalElement(item: HTMLElement, context: ReadingContext): HTMLElement | undefined {
  if (item.closest(`${localRowSelector}, [hidden]`)) return;
  const group = item.closest<HTMLElement>('[data-work-group]');
  if (!group) return item;
  if (group.hasAttribute('data-windowed-work')) {
    if (group.tagName !== 'DETAILS' || !item.dataset.itemKey || !item.dataset.node || !group.dataset.workGroup) return;
    const firstOnly = !group.hasAttribute('open');
    if (!context.groupMember?.(group.dataset.workGroup, item.dataset.itemKey, item.dataset.node, firstOnly)) return;
    return firstOnly === item.hasAttribute('data-windowed-heading') ? item : undefined;
  }
  let members: unknown;
  try { members = JSON.parse(group.dataset.headingMemberKeys ?? 'null'); } catch { return; }
  if (!Array.isArray(members) || members.some(key => typeof key !== 'string') || new Set(members).size !== members.length || !members.includes(item.dataset.itemKey)) return;
  const actual = [...group.querySelectorAll<HTMLElement>('[data-item-key]')].filter(el => !el.closest(localRowSelector));
  if (actual.length !== members.length || actual.some((el, index) => el.closest('[data-work-group]') !== group || el.dataset.itemKey !== members[index])) return;
  if (group.tagName !== 'DETAILS') return;
  return group.hasAttribute('open') ? item : group.querySelector<HTMLElement>(':scope > summary[data-work-heading]') ?? undefined;
}

function readingItems(box: HTMLElement, context: ReadingContext): HTMLElement[] | undefined {
  const items = [...box.querySelectorAll<HTMLElement>('.conversation-items [data-item-key]')];
  const nodes = "has" in context.nodes ? context.nodes : new Set(context.nodes), keys = new Set<string>();
  for (const item of items) {
    if (item.closest(localRowSelector)) continue;
    const { itemKey, node } = item.dataset;
    if (!itemKey || keys.has(itemKey) || !node || !nodes.has(node)) return;
    keys.add(itemKey);
  }
  return items;
}

/** Only prose paragraphs in this item's own rendered body, not its chrome or nested items. */
function bodyParagraphs(item: HTMLElement): HTMLElement[] {
  const bodies = [...item.querySelectorAll<HTMLElement>('[data-reading-body]')]
    .filter(body => body.closest('[data-item-key]') === item && !body.closest('[hidden]'));
  if (bodies.length !== 1) return [];
  return [...bodies[0]!.querySelectorAll<HTMLElement>(':scope > p')];
}

function captureParagraph(item: HTMLElement, viewport: DOMRect): { text: string; offset: number } | undefined {
  const paragraphs = bodyParagraphs(item);
  for (const paragraph of paragraphs) {
    const rect = paragraph.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
    const text = paragraph.textContent;
    if (text?.trim() && paragraphs.filter(candidate => candidate.textContent === text).length === 1)
      return { text, offset: rect.top - viewport.top };
    return;
  }
}

type CanonicalAnchor = { key: string; offset: number; epoch: number; capability: object } &
  ({ kind: 'saved'; node: string; paragraph?: { text: string; offset: number } } | { kind: 'preview'; attempt: string; text: string });

export class ReadingAnchor {
  private canonical: CanonicalAnchor | undefined;
  private saved: { node: string; step?: string; members: string[]; offset: number } | undefined;
  capture(box: HTMLElement, context?: ReadingContext): void {
    this.canonical = undefined;
    if (box.querySelector('.conversation-items')) {
      this.saved = undefined;
      if (!context?.isCurrent() || context.revision === undefined) return;
      const items = readingItems(box, context);
      if (!items) return;
      const viewport = box.getBoundingClientRect();
      const top = viewport.top;
      for (const item of items) {
        const key = item.dataset.itemKey!;
        const attempt = item.dataset.handoffAttempt;
        const element = attempt && !item.closest('[hidden]') ? item : canonicalElement(item, context);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= top) continue;
        if (!context.isCurrent()) return;
        const anchor = { key, offset: rect.top - top, epoch: context.epoch, capability: context.capability };
        if (attempt) {
          const text = context.previewText?.(key, attempt);
          if (text && items.filter(other => other.dataset.handoffAttempt === attempt).length === 1)
            this.canonical = { ...anchor, kind: 'preview', attempt, text };
        } else if (item.dataset.node) {
          const paragraph = element === item ? captureParagraph(item, viewport) : undefined;
          if (context.isCurrent()) this.canonical = { ...anchor, kind: 'saved', node: item.dataset.node, paragraph };
        }
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
      if (!context?.isCurrent() || context.revision === undefined || context.epoch !== canonical.epoch || context.capability !== canonical.capability) return;
      const items = readingItems(box, context);
      if (!items) return;
      const savedItems = items.filter(item => !item.closest(localRowSelector));
      let element: HTMLElement | undefined;
      if (canonical.kind === 'saved') {
        // Requalify the exact key and node in the current rendered cut, regardless of revision.
        const match = savedItems.find(item => item.dataset.itemKey === canonical.key && item.dataset.node === canonical.node);
        if (match) element = canonicalElement(match, context);
        if (canonical.paragraph) {
          if (!match || element !== match) return;
          const { text, offset } = canonical.paragraph;
          const paragraphs = bodyParagraphs(match).filter(p => p.textContent === text);
          if (paragraphs.length !== 1) return;
          const rect = paragraphs[0]!.getBoundingClientRect();
          if (rect.height <= 0) return;
          const delta = rect.top - box.getBoundingClientRect().top - offset;
          return context.isCurrent() ? delta : undefined;
        }
      } else {
        const previews = items.filter(item => item.dataset.handoffAttempt === canonical.attempt);
        if (previews.length) {
          const preview = previews[0]!;
          if (previews.length === 1 && preview.dataset.itemKey === canonical.key && !preview.closest('[hidden]') && context.previewText?.(canonical.key, canonical.attempt)?.startsWith(canonical.text)) element = preview;
        } else {
          const provenNodes = [...(context.assistantAttempts ?? [])].filter(([, attempt]) => attempt === canonical.attempt);
          if (provenNodes.length !== 1) return;
          const node = provenNodes[0]![0];
          // Text confirms continuity only after exact owner provenance proves succession.
          const matches = savedItems.filter(item => item.dataset.node === node && context.savedText?.(item.dataset.itemKey!, node) !== undefined);
          if (matches.length === 1 && context.savedText?.(matches[0]!.dataset.itemKey!, node)?.startsWith(canonical.text)) element = canonicalElement(matches[0]!, context);
        }
      }
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
