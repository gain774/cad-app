import type { CadDocument } from "../core/model/Document.ts";
import type { Entity } from "../core/model/entities.ts";
import { entityBounds } from "../core/model/entities.ts";
import type { Vec2 } from "../core/math/Vec2.ts";
import type { Viewport } from "./Viewport.ts";
import type { SnapResult } from "../snap/SnapEngine.ts";

export interface RenderState {
  selection: Set<string>;
  hover: string | null;
  snap: SnapResult | null;
  /** Entities drawn as a live preview (not yet committed). */
  preview: Entity[];
  /** Rubber-band selection rectangle in screen space. */
  marquee: { x0: number; y0: number; x1: number; y1: number; crossing: boolean } | null;
  cursor: Vec2 | null;
  gridSize: number;
  showGrid: boolean;
}

const COLORS = {
  bg: "#1e1e22",
  gridMinor: "#2a2a30",
  gridMajor: "#35353d",
  axis: "#4a4a55",
  selection: "#ffb454",
  hover: "#8ab4f8",
  snap: "#00e5a0",
  marquee: "#8ab4f8",
  marqueeCrossing: "#4ade80",
  preview: "#ffb454",
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = window.devicePixelRatio || 1;

  constructor(private canvas: HTMLCanvasElement, private doc: CadDocument, private vp: Viewport) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  resize(): void {
    const host = this.canvas.parentElement!;
    const w = host.clientWidth;
    const h = host.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.vp.resize(w, h);
  }

  render(state: RenderState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.vp.width, this.vp.height);

    if (state.showGrid) this.drawGrid(state.gridSize);
    this.drawAxes();

    const vb = this.vp.visibleBounds();
    const ids = this.doc.queryIds(vb);
    // Draw committed entities (culled).
    for (const id of ids) {
      const e = this.doc.get(id);
      if (!e) continue;
      if (!this.doc.isLayerVisible(e.layer)) continue;
      const selected = state.selection.has(id);
      const hovered = state.hover === id;
      this.drawEntity(e, this.doc.effectiveColor(e), selected, hovered);
    }

    // Preview entities.
    for (const e of state.preview) {
      this.drawEntity(e, COLORS.preview, false, false, true);
    }

    if (state.marquee) this.drawMarquee(state.marquee);
    if (state.snap) this.drawSnap(state.snap);
  }

  private drawGrid(gridSize: number): void {
    if (gridSize <= 0) return;
    const ctx = this.ctx;
    const vb = this.vp.visibleBounds();
    // Choose an on-screen spacing that stays legible; step up by powers when dense.
    let step = gridSize;
    while (this.vp.toScreenLength(step) < 8) step *= 5;
    const majorEvery = 5;

    const startX = Math.floor(vb.minX / step) * step;
    const startY = Math.floor(vb.minY / step) * step;

    ctx.lineWidth = 1;
    for (let x = startX; x <= vb.maxX; x += step) {
      const s = this.vp.worldToScreen({ x, y: 0 });
      const major = Math.round(x / step) % majorEvery === 0;
      ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, 0);
      ctx.lineTo(Math.round(s.x) + 0.5, this.vp.height);
      ctx.stroke();
    }
    for (let y = startY; y <= vb.maxY; y += step) {
      const s = this.vp.worldToScreen({ x: 0, y });
      const major = Math.round(y / step) % majorEvery === 0;
      ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(s.y) + 0.5);
      ctx.lineTo(this.vp.width, Math.round(s.y) + 0.5);
      ctx.stroke();
    }
  }

  private drawAxes(): void {
    const ctx = this.ctx;
    const o = this.vp.worldToScreen({ x: 0, y: 0 });
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(o.y) + 0.5);
    ctx.lineTo(this.vp.width, Math.round(o.y) + 0.5);
    ctx.moveTo(Math.round(o.x) + 0.5, 0);
    ctx.lineTo(Math.round(o.x) + 0.5, this.vp.height);
    ctx.stroke();
  }

  private drawEntity(
    e: Entity,
    color: string,
    selected: boolean,
    hovered: boolean,
    preview = false,
  ): void {
    const ctx = this.ctx;
    ctx.strokeStyle = selected ? COLORS.selection : hovered ? COLORS.hover : color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = selected || hovered ? 2 : 1.25;
    if (preview) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }

    switch (e.type) {
      case "line": {
        const a = this.vp.worldToScreen(e.a);
        const b = this.vp.worldToScreen(e.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case "polyline": {
        ctx.beginPath();
        e.points.forEach((p, i) => {
          const s = this.vp.worldToScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case "circle": {
        const c = this.vp.worldToScreen(e.center);
        const r = this.vp.toScreenLength(e.radius);
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(r, 0.1), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "arc": {
        const c = this.vp.worldToScreen(e.center);
        const r = this.vp.toScreenLength(e.radius);
        ctx.beginPath();
        // Screen Y is flipped, so CCW world arcs are CW on screen.
        ctx.arc(c.x, c.y, Math.max(r, 0.1), -e.startAngle, -e.endAngle, true);
        ctx.stroke();
        break;
      }
      case "text": {
        const p = this.vp.worldToScreen(e.position);
        const px = this.vp.toScreenLength(e.height);
        if (px < 3) break;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-e.rotation);
        ctx.font = `${px}px sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.setLineDash([]);
        ctx.fillText(e.content, 0, 0);
        ctx.restore();
        break;
      }
    }
    ctx.setLineDash([]);

    if (selected) this.drawGrips(e);
  }

  private drawGrips(e: Entity): void {
    const ctx = this.ctx;
    const b = entityBounds(e);
    const pts: Vec2[] = [];
    switch (e.type) {
      case "line":
        pts.push(e.a, e.b);
        break;
      case "polyline":
        pts.push(...e.points);
        break;
      case "circle":
      case "arc":
        pts.push(e.center);
        break;
      case "text":
        pts.push(e.position);
        break;
    }
    // Bounding grip corners kept subtle; vertex grips are the interactive ones.
    ctx.fillStyle = COLORS.selection;
    for (const p of pts) {
      const s = this.vp.worldToScreen(p);
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }
    void b;
  }

  private drawMarquee(m: RenderState["marquee"] & object): void {
    const ctx = this.ctx;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);
    ctx.save();
    ctx.strokeStyle = m.crossing ? COLORS.marqueeCrossing : COLORS.marquee;
    ctx.fillStyle = m.crossing ? "rgba(74,222,128,0.08)" : "rgba(138,180,248,0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash(m.crossing ? [5, 3] : []);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  private drawSnap(snap: SnapResult): void {
    const ctx = this.ctx;
    const s = this.vp.worldToScreen(snap.point);
    ctx.save();
    ctx.strokeStyle = COLORS.snap;
    ctx.fillStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    const r = 6;
    switch (snap.kind) {
      case "end":
        ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
        break;
      case "mid":
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - r);
        ctx.lineTo(s.x + r, s.y + r);
        ctx.lineTo(s.x - r, s.y + r);
        ctx.closePath();
        ctx.stroke();
        break;
      case "center":
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "intersect":
        ctx.beginPath();
        ctx.moveTo(s.x - r, s.y - r);
        ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x + r, s.y - r);
        ctx.lineTo(s.x - r, s.y + r);
        ctx.stroke();
        break;
      case "grid":
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.restore();
  }
}
