import type { Bounds } from "../math/geometry.ts";
import { boundsIntersect } from "../math/geometry.ts";

/**
 * A uniform spatial hash grid for broad-phase queries. Keeps rendering and
 * hit-testing fast on large drawings by only visiting entities whose cells
 * overlap the query region. Cell size adapts as the drawing grows.
 */
export class SpatialGrid {
  private cellSize: number;
  private cells = new Map<string, Set<string>>();
  private itemBounds = new Map<string, Bounds>();

  constructor(cellSize = 200) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  private cellRange(b: Bounds): { x0: number; y0: number; x1: number; y1: number } {
    const cs = this.cellSize;
    return {
      x0: Math.floor(b.minX / cs),
      y0: Math.floor(b.minY / cs),
      x1: Math.floor(b.maxX / cs),
      y1: Math.floor(b.maxY / cs),
    };
  }

  insert(id: string, b: Bounds): void {
    if (!isFinite(b.minX) || !isFinite(b.maxX)) return;
    this.itemBounds.set(id, b);
    const r = this.cellRange(b);
    // Guard against pathologically large spans (e.g. an item covering the world).
    const span = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (span > 4096) {
      this.getOversized().add(id);
      return;
    }
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const k = this.key(cx, cy);
        let set = this.cells.get(k);
        if (!set) {
          set = new Set();
          this.cells.set(k, set);
        }
        set.add(id);
      }
    }
  }

  private oversized = new Set<string>();
  private getOversized(): Set<string> {
    return this.oversized;
  }

  remove(id: string): void {
    const b = this.itemBounds.get(id);
    this.itemBounds.delete(id);
    this.oversized.delete(id);
    if (!b) return;
    const r = this.cellRange(b);
    const span = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (span > 4096) return;
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const k = this.key(cx, cy);
        const set = this.cells.get(k);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.cells.delete(k);
        }
      }
    }
  }

  update(id: string, b: Bounds): void {
    this.remove(id);
    this.insert(id, b);
  }

  /** Return candidate ids whose cells overlap the query bounds. */
  query(b: Bounds): Set<string> {
    const found = new Set<string>();
    const r = this.cellRange(b);
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const set = this.cells.get(this.key(cx, cy));
        if (set) for (const id of set) found.add(id);
      }
    }
    // Oversized items must always be considered; verify with real bounds.
    for (const id of this.oversized) {
      const ib = this.itemBounds.get(id);
      if (ib && boundsIntersect(ib, b)) found.add(id);
    }
    return found;
  }

  clear(): void {
    this.cells.clear();
    this.itemBounds.clear();
    this.oversized.clear();
  }

  get size(): number {
    return this.itemBounds.size;
  }
}
