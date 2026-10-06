/** Default sizes plus sparse overrides; no allocation per row. */
export class GridAxis {
  private readonly overrides = new Map<number, number>();
  private readonly hidden = new Set<number>();
  private keys: number[] = [];
  private deltas: number[] = [];

  constructor(public count: number, readonly defaultSize: number) {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(defaultSize) || defaultSize <= 0 || !Number.isFinite(count * defaultSize)) throw new RangeError('Invalid axis dimensions.');
  }

  size(index: number): number { return this.hidden.has(index) ? 0 : this.storedSize(index); }
  storedSize(index: number): number { return this.overrides.get(index) ?? this.defaultSize; }
  isHidden(index:number):boolean {return this.hidden.has(index);}
  hiddenIndices(): number[] { return [...this.hidden].sort((a,b)=>a-b); }
  replaceHidden(indices: readonly number[]): void {
    if(new Set(indices).size!==indices.length||indices.some(index=>!Number.isSafeInteger(index)||index<0||index>=this.count))throw new RangeError('Invalid hidden axis indices.');
    this.hidden.clear();for(const index of indices)this.hidden.add(index);this.rebuild();
  }

  position(index: number): number {
    let low = 0;
    let high = this.keys.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.keys[mid]! < index) low = mid + 1;
      else high = mid;
    }
    return index * this.defaultSize + (low ? this.deltas[low - 1]! : 0);
  }

  indexAt(offset: number): number {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.position(mid) <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  range(offset: number, extent: number): { start: number; end: number } {
    const start = this.indexAt(Math.max(0, offset));
    if (extent <= 0) return { start, end: start };
    const edge = Math.max(0, offset) + extent;
    const index = this.indexAt(edge);
    return { start, end: Math.min(this.count, index + (this.position(index) < edge ? 1 : 0)) };
  }

  snapshot(): readonly (readonly [number, number])[] { return [...this.overrides]; }

  replace(count: number, sizes: readonly (readonly [number, number])[]): void {
    const next = new GridAxis(count, this.defaultSize);
    for (const [index, size] of sizes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || !Number.isFinite(size) || size <= 0) throw new RangeError('Invalid axis snapshot.');
      if (size !== this.defaultSize) next.overrides.set(index,size);
    }
    next.rebuild();
    if (!Number.isFinite(next.position(count))) throw new RangeError('Axis dimensions overflow.');
    this.count = count; this.overrides.clear();
    this.hidden.clear();
    for (const [index, size] of sizes) this.overrides.set(index, size);
    this.rebuild();
  }

  private rebuild(): void {
    this.keys = [...new Set([...this.overrides.keys(),...this.hidden])].sort((a, b) => a - b);
    let delta = 0;
    this.deltas = this.keys.map(key => delta += this.size(key) - this.defaultSize);
  }

  setSize(index: number, size: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count || !Number.isFinite(size) || size <= 0) throw new RangeError('Invalid cell size or index.');
    if (!Number.isFinite(this.position(this.count) - this.size(index) + (this.hidden.has(index)?0:size))) throw new RangeError('Axis dimensions overflow.');
    if (size === this.defaultSize) this.overrides.delete(index);
    else this.overrides.set(index, size);
    // rebuild sparse prefix deltas on resize; a tree if frequent bulk resizing needs it.
    this.rebuild();
  }
}
