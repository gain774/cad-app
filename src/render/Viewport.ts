import type { Bounds } from "../core/math/geometry.ts";
import type { Vec2 } from "../core/math/Vec2.ts";

/**
 * Maps between world coordinates (CAD units, Y up) and screen pixels (Y down).
 * The viewport stores the world point at the screen origin and a scale
 * (pixels per world unit).
 */
export class Viewport {
  /** Pixels per world unit. */
  scale = 1;
  /** World coordinate currently at screen (0,0) top-left. */
  originX = 0;
  originY = 0;

  width = 0;
  height = 0;

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  worldToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x - this.originX) * this.scale,
      y: (this.originY - p.y) * this.scale,
    };
  }

  screenToWorld(p: Vec2): Vec2 {
    return {
      x: this.originX + p.x / this.scale,
      y: this.originY - p.y / this.scale,
    };
  }

  /** World length -> screen pixels. */
  toScreenLength(len: number): number {
    return len * this.scale;
  }
  toWorldLength(px: number): number {
    return px / this.scale;
  }

  panByScreen(dx: number, dy: number): void {
    this.originX -= dx / this.scale;
    this.originY += dy / this.scale;
  }

  /** Zoom keeping the given screen point anchored to its world position. */
  zoomAt(screen: Vec2, factor: number): void {
    const before = this.screenToWorld(screen);
    this.scale = Math.min(1e7, Math.max(1e-5, this.scale * factor));
    const after = this.screenToWorld(screen);
    this.originX += before.x - after.x;
    this.originY += before.y - after.y;
  }

  /** Fit the given world bounds into the viewport with padding. */
  fit(b: Bounds, padding = 40): void {
    if (!isFinite(b.minX) || b.maxX < b.minX) {
      this.scale = 1;
      this.originX = -this.width / 2;
      this.originY = this.height / 2;
      return;
    }
    const bw = Math.max(b.maxX - b.minX, 1e-6);
    const bh = Math.max(b.maxY - b.minY, 1e-6);
    const sx = (this.width - padding * 2) / bw;
    const sy = (this.height - padding * 2) / bh;
    this.scale = Math.min(sx, sy);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.originX = cx - this.width / 2 / this.scale;
    this.originY = cy + this.height / 2 / this.scale;
  }

  /** World bounds currently visible on screen. */
  visibleBounds(): Bounds {
    const tl = this.screenToWorld({ x: 0, y: 0 });
    const br = this.screenToWorld({ x: this.width, y: this.height });
    return {
      minX: Math.min(tl.x, br.x),
      minY: Math.min(tl.y, br.y),
      maxX: Math.max(tl.x, br.x),
      maxY: Math.max(tl.y, br.y),
    };
  }
}
