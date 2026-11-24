/** Prefix sums for mounted measurements and provisional rows. Unloaded rows are never inserted. */
export class ViewportGeometry {
  private readonly indices: ReadonlyMap<string, number>;
  private readonly measured = new Map<string, number>();
  private readonly sums: Float64Array;
  private readonly counts: Float64Array;
  private sum = 0;
  constructor(readonly keys: readonly string[], private readonly fallback: number, previous?: ViewportGeometry) {
    this.indices = new Map(keys.map((key, index) => [key, index]));
    this.sums = new Float64Array(keys.length + 1);
    this.counts = new Float64Array(keys.length + 1);
    for (const key of keys) {
      const known = previous?.measured.get(key);
      if (known !== undefined) this.measure(key, known);
    }
  }
  indexOf(key: string): number | undefined { return this.indices.get(key); }
  measure(key: string, height: number): boolean {
    const index = this.indices.get(key), old = this.measured.get(key);
    if (index === undefined || !Number.isFinite(height) || height < 0 || old === height) return false;
    this.measured.set(key, height);
    const delta = height - (old ?? 0);
    this.sum += delta;
    for (let i = index + 1; i < this.sums.length; i += i & -i) {
      this.sums[i] = this.sums[i]! + delta;
      if (old === undefined) this.counts[i] = this.counts[i]! + 1;
    }
    return true;
  }
  offset(end: number): number {
    let sum = 0, count = 0;
    for (let i = end; i > 0; i -= i & -i) { sum += this.sums[i]!; count += this.counts[i]!; }
    const estimate = this.measured.size ? this.sum / this.measured.size : this.fallback;
    return sum + (end - count) * estimate;
  }
  locate(y: number): number {
    let first = 0, end = this.keys.length;
    while (first < end) {
      const mid = (first + end) >>> 1;
      if (this.offset(mid + 1) > y) end = mid;
      else first = mid + 1;
    }
    return Math.min(first, Math.max(0, this.keys.length - 1));
  }
  range(top: number, height: number, following: boolean): readonly [number, number] {
    const end = this.keys.length;
    if (!end) return [0, 0];
    const bottom = following ? this.offset(end) : top + height;
    const start = following ? Math.max(0, bottom - height) : top;
    const overscan = 4;
    return [Math.max(0, this.locate(start) - overscan), Math.min(end, this.locate(bottom) + 1 + overscan)];
  }
}
