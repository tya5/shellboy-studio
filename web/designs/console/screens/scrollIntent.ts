/** Keep an upward gesture detached until the user returns to the actual end. */
export class ScrollIntent {
  following = true;
  private top = 0;
  private programTop: number | undefined;
  private touchY: number | undefined;
  detach(): void { this.following = false; }
  program(box: HTMLElement, top: number): void {
    box.scrollTop = top;
    this.top = box.scrollTop;
    this.programTop = box.scrollTop;
  }
  touchStart(y: number): void { this.touchY = y; }
  touchMove(y: number): void {
    if (this.touchY !== undefined && y > this.touchY) this.detach();
    this.touchY = y;
  }
  key(key: string): void { if (["PageUp", "Home", "ArrowUp"].includes(key)) this.detach(); }
  wheel(deltaY: number): void { if (deltaY < 0) this.detach(); }
  scroll(box: HTMLElement): boolean {
    const top = box.scrollTop;
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
