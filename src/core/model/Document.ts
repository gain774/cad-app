import type { Bounds } from "../math/geometry.ts";
import { emptyBounds, unionBounds } from "../math/geometry.ts";
import { SpatialGrid } from "../spatial/SpatialGrid.ts";
import { entityBounds, type Entity } from "./entities.ts";

export interface Layer {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export type ChangeListener = () => void;

/**
 * The drawing document: layers plus a flat, id-indexed entity store backed by
 * a spatial grid. All mutations funnel through add/remove/replace so the index
 * and change listeners stay consistent.
 */
export class CadDocument {
  private entities = new Map<string, Entity>();
  private grid = new SpatialGrid(200);
  layers: Layer[] = [];
  activeLayer = "0";
  private listeners = new Set<ChangeListener>();

  constructor() {
    this.layers.push({ name: "0", color: "#e8e8e8", visible: true, locked: false });
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // --- layers ---------------------------------------------------------------

  getLayer(name: string): Layer | undefined {
    return this.layers.find((l) => l.name === name);
  }

  addLayer(name: string, color = "#8ab4f8"): Layer {
    let l = this.getLayer(name);
    if (!l) {
      l = { name, color, visible: true, locked: false };
      this.layers.push(l);
      this.emit();
    }
    return l;
  }

  removeLayer(name: string): void {
    if (name === "0" || this.layers.length <= 1) return;
    for (const e of this.entities.values()) {
      if (e.layer === name) this.remove(e.id);
    }
    this.layers = this.layers.filter((l) => l.name !== name);
    if (this.activeLayer === name) this.activeLayer = this.layers[0].name;
    this.emit();
  }

  effectiveColor(e: Entity): string {
    if (e.color) return e.color;
    return this.getLayer(e.layer)?.color ?? "#e8e8e8";
  }

  isLayerVisible(name: string): boolean {
    return this.getLayer(name)?.visible ?? true;
  }

  isLayerLocked(name: string): boolean {
    return this.getLayer(name)?.locked ?? false;
  }

  // --- entities -------------------------------------------------------------

  add(e: Entity, silent = false): void {
    this.entities.set(e.id, e);
    this.grid.insert(e.id, entityBounds(e));
    if (!silent) this.emit();
  }

  remove(id: string, silent = false): Entity | undefined {
    const e = this.entities.get(id);
    if (!e) return undefined;
    this.entities.delete(id);
    this.grid.remove(id);
    if (!silent) this.emit();
    return e;
  }

  replace(e: Entity, silent = false): void {
    this.entities.set(e.id, e);
    this.grid.update(e.id, entityBounds(e));
    if (!silent) this.emit();
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  all(): IterableIterator<Entity> {
    return this.entities.values();
  }

  get count(): number {
    return this.entities.size;
  }

  /** Ids whose bounds overlap the query region (broad phase). */
  queryIds(b: Bounds): Set<string> {
    return this.grid.query(b);
  }

  totalBounds(): Bounds {
    let b = emptyBounds();
    for (const e of this.entities.values()) {
      b = unionBounds(b, entityBounds(e));
    }
    return b;
  }

  clear(): void {
    this.entities.clear();
    this.grid.clear();
    this.layers = [{ name: "0", color: "#e8e8e8", visible: true, locked: false }];
    this.activeLayer = "0";
    this.emit();
  }

  notify(): void {
    this.emit();
  }
}
