/** Initial counterexample scaffold, not wired into store/window publication. */
export class AcceptedView<T> {
  current: T;
  private listeners = new Set<(value: T) => void>();
  constructor(initial: T) { this.current = initial; }
  stage(value: T): T { return value; }
  commit(value: T, valid: () => boolean): boolean {
    if (!valid()) return false;
    this.current = value;
    for (const listener of [...this.listeners]) listener(value);
    return true;
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
}
