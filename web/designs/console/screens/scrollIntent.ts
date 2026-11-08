/** Keep an upward gesture detached until the user returns to the actual end. */
export class ScrollIntent {
  following = true;
  private top = 0;
  private programTop: number | undefined;
  program(box: HTMLElement, top: number): void {
    box.scrollTop = top;
    this.top = box.scrollTop;
    this.programTop = box.scrollTop;
  }
  touchStart(_y: number): void {}
  touchMove(_y: number): void {}
  key(_key: string): void {}
  wheel(_deltaY: number): void {}
  scroll(box: HTMLElement): boolean {
    const top = box.scrollTop;
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
    if (top < this.top) this.following = false;
    else if (box.scrollHeight - top - box.clientHeight <= 1) this.following = true;
    this.top = top;
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
