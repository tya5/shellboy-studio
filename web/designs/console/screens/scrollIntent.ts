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
export class HeadingAnchor {
  private saved: { heading: HTMLElement; top: number } | undefined;
  capture(heading: HTMLElement): void {
    this.saved = { heading, top: heading.getBoundingClientRect().top };
  }
  correction(): number | undefined {
    const saved = this.saved;
    this.saved = undefined;
    return saved?.heading.isConnected ? saved.heading.getBoundingClientRect().top - saved.top : undefined;
  }
}

/** A measured DOM anchor survives regrouping when an adjacent window extends a tool run. */
export class ReadingAnchor {
  private saved: { node: string; step?: string; members: string[]; offset: number } | undefined;
  capture(box: HTMLElement): void {
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
  correction(box: HTMLElement): number | undefined {
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
