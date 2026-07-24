import { CadDocument } from "./core/model/Document.ts";
import { History, RemoveEntities, ReplaceEntities } from "./core/commands/History.ts";
import {
  distanceToEntity,
  entityBounds,
  translateEntity,
  type Entity,
} from "./core/model/entities.ts";
import { boundsIntersect, type Bounds } from "./core/math/geometry.ts";
import { distance, sub, type Vec2 } from "./core/math/Vec2.ts";
import { Viewport } from "./render/Viewport.ts";
import { Renderer, type RenderState } from "./render/Renderer.ts";
import { SnapEngine, type SnapResult, type SnapSettings } from "./snap/SnapEngine.ts";
import type { EditorContext, Tool } from "./tools/Tool.ts";
import { parseInput, resolvePoint } from "./ui/coordinates.ts";
import type { Viewer3D } from "./render3d/Viewer3D.ts";

export type ViewMode = "2d" | "3d";

export class Editor {
  doc = new CadDocument();
  vp = new Viewport();
  history = new History(this.doc);
  private renderer: Renderer;
  private snap: SnapEngine;

  private tool: Tool | null = null;
  private selection = new Set<string>();
  private hover: string | null = null;

  private preview: Entity[] = [];
  private snapResult: SnapResult | null = null;
  private cursorScreen: Vec2 = { x: 0, y: 0 };
  private cursorRaw: Vec2 = { x: 0, y: 0 };
  private lastPoint: Vec2 | null = null;

  private marquee: RenderState["marquee"] = null;
  private dragging = false;
  private dragBase: Vec2 | null = null;
  private dragOriginals: Entity[] = [];

  // Multi-pointer / touch state.
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: { dist: number; mid: Vec2 } | null = null;
  private opType: "tool" | "tool-tap" | "drag" | "marquee" | "pan" | null = null;
  private opStart: Vec2 | null = null;
  private opMoved = false;
  private readonly tapSlop = 6;

  snapSettings: SnapSettings = {
    grid: true,
    end: true,
    mid: true,
    center: true,
    intersect: true,
    gridSize: 10,
  };

  private renderScheduled = false;

  // 2D / 3D view mode.
  mode: ViewMode = "2d";
  private viewer3d: Viewer3D | null = null;
  showGrid = true;

  // UI callbacks (wired up by main.ts).
  onPromptChange: ((text: string) => void) | null = null;
  onStatusChange: (() => void) | null = null;
  onToolChange: ((name: string) => void) | null = null;
  onModeChange: ((mode: ViewMode) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.doc, this.vp);
    this.snap = new SnapEngine(this.doc, this.vp);
    this.renderer.resize();
    this.vp.fit(this.doc.totalBounds());
    this.attachEvents();
    this.doc.onChange(() => {
      this.onStatusChange?.();
      this.requestRender();
      this.refresh3D();
    });
    this.history.onChange = () => {
      this.onStatusChange?.();
      this.requestRender();
      this.refresh3D();
    };
    this.requestRender();
  }

  // --- context handed to tools ---------------------------------------------

  private ctx(): EditorContext {
    return {
      doc: this.doc,
      history: this.history,
      activeLayer: () => this.doc.activeLayer,
      setPrompt: (t) => this.onPromptChange?.(t),
      setPreview: (e) => {
        this.preview = e;
        this.requestRender();
      },
      requestRender: () => this.requestRender(),
      cursorWorld: () => this.snapResult?.point ?? this.cursorRaw,
      setSelection: (ids) => {
        this.selection = ids;
        this.requestRender();
        this.onStatusChange?.();
      },
      getSelection: () => this.selection,
      finishToSelect: () => this.setTool(null),
    };
  }

  // --- tool management ------------------------------------------------------

  setTool(tool: Tool | null): void {
    if (this.tool) this.tool.deactivate(this.ctx());
    this.tool = tool;
    this.preview = [];
    if (tool) {
      tool.activate(this.ctx());
      this.onToolChange?.(tool.name);
    } else {
      this.onPromptChange?.("コマンド:");
      this.onToolChange?.("select");
    }
    this.requestRender();
  }

  get activeToolName(): string {
    return this.tool?.name ?? "select";
  }

  // --- rendering ------------------------------------------------------------

  requestRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderer.render({
        selection: this.selection,
        hover: this.hover,
        snap: this.snapResult,
        preview: this.preview,
        marquee: this.marquee,
        cursor: this.cursorRaw,
        gridSize: this.snapSettings.gridSize,
        showGrid: this.showGrid,
      });
    });
  }

  resize(): void {
    this.renderer.resize();
    this.requestRender();
    if (this.mode === "3d") this.viewer3d?.resize();
  }

  zoomExtents(): void {
    if (this.mode === "3d") {
      this.viewer3d?.frameContent();
      return;
    }
    const b = this.doc.totalBounds();
    this.vp.fit(b);
    this.requestRender();
  }

  // --- 2D / 3D mode ---------------------------------------------------------

  private viewerPromise: Promise<Viewer3D> | null = null;

  /** Lazily import Three.js + the 3D viewer only when 3D is first used. */
  private ensureViewer(): Promise<Viewer3D> {
    if (this.viewer3d) return Promise.resolve(this.viewer3d);
    if (!this.viewerPromise) {
      this.viewerPromise = import("./render3d/Viewer3D.ts").then(({ Viewer3D }) => {
        const host = this.canvas.parentElement!;
        this.viewer3d = new Viewer3D(host, this.doc);
        return this.viewer3d;
      });
    }
    return this.viewerPromise;
  }

  async setMode(mode: ViewMode): Promise<void> {
    if (mode === this.mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
    if (mode === "3d") {
      const v = await this.ensureViewer();
      if (this.mode === "3d") v.activate();
    } else {
      this.viewer3d?.deactivate();
    }
  }

  toggleMode(): void {
    void this.setMode(this.mode === "2d" ? "3d" : "2d");
  }

  /** Rebuild the 3D model from the current document (call after edits). */
  refresh3D(): void {
    if (this.mode === "3d" && this.viewer3d) {
      this.viewer3d.rebuild();
    }
  }

  async setStandardView3D(view: "top" | "front" | "right" | "iso"): Promise<void> {
    const v = await this.ensureViewer();
    v.setStandardView(view);
  }

  // --- input ----------------------------------------------------------------

  private attachEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => this.onPointerMove(e));
    c.addEventListener("pointerup", (e) => this.onPointerUp(e));
    c.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    // Prevent iOS Safari double-tap / pinch page zoom over the canvas.
    c.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  }

  private screenOf(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  snapPixelTolerance = 12;

  private updateCursor(screen: Vec2): void {
    this.cursorScreen = screen;
    this.cursorRaw = this.vp.screenToWorld(screen);
    this.snapResult = this.snap.resolve(this.cursorRaw, this.snapSettings, this.snapPixelTolerance);
  }

  /** The point the tools should use: snapped if available, else raw. */
  private effectivePoint(): Vec2 {
    return this.snapResult?.point ?? this.cursorRaw;
  }

  /** Ortho (直交) mode: constrain to horizontal/vertical from the last point. */
  ortho = false;
  private toolPoint(): Vec2 {
    const p = this.effectivePoint();
    if (this.ortho && this.lastPoint) {
      const dx = Math.abs(p.x - this.lastPoint.x);
      const dy = Math.abs(p.y - this.lastPoint.y);
      return dx >= dy ? { x: p.x, y: this.lastPoint.y } : { x: this.lastPoint.x, y: p.y };
    }
    return p;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.vp.zoomAt(screen, factor);
    this.updateCursor(screen);
    this.requestRender();
  }

  private isTouch(e: PointerEvent): boolean {
    return e.pointerType === "touch";
  }

  private onPointerDown(e: PointerEvent): void {
    const screen = this.screenOf(e);
    this.pointers.set(e.pointerId, { x: screen.x, y: screen.y, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    // A second pointer starts a pinch/pan gesture and cancels any single-pointer op.
    if (this.pointers.size >= 2) {
      this.cancelSingleOp();
      this.beginGesture();
      return;
    }

    this.updateCursor(screen);
    this.opStart = screen;
    this.opMoved = false;
    const touch = this.isTouch(e);

    // Mouse middle / right button => pan.
    if (!touch && (e.button === 1 || e.button === 2)) {
      this.opType = "pan";
      return;
    }
    if (!touch && e.button !== 0) {
      this.pointers.delete(e.pointerId);
      return;
    }

    if (this.tool) {
      if (touch) {
        // Defer placement to a tap (pointerup); dragging just moves the rubber band.
        this.opType = "tool-tap";
        this.tool.onMove(this.toolPoint(), this.ctx());
      } else {
        const p = this.toolPoint();
        this.tool.onPoint(p, this.ctx());
        this.lastPoint = p;
        this.opType = "tool";
      }
      this.requestRender();
      return;
    }

    // Select mode.
    const hitId = this.hitTest(this.cursorRaw);
    if (hitId) {
      if (e.shiftKey) {
        if (this.selection.has(hitId)) this.selection.delete(hitId);
        else this.selection.add(hitId);
      } else if (!this.selection.has(hitId)) {
        this.selection.clear();
        this.selection.add(hitId);
      }
      this.dragBase = this.effectivePoint();
      this.dragOriginals = [...this.selection]
        .map((id) => this.doc.get(id))
        .filter((x): x is Entity => !!x);
      this.opType = "drag";
      this.onStatusChange?.();
    } else if (touch) {
      // One finger on empty space pans the view (mobile-friendly default).
      this.opType = "pan";
    } else {
      if (!e.shiftKey) this.selection.clear();
      this.marquee = { x0: screen.x, y0: screen.y, x1: screen.x, y1: screen.y, crossing: false };
      this.opType = "marquee";
    }
    this.requestRender();
  }

  private onPointerMove(e: PointerEvent): void {
    const screen = this.screenOf(e);
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) {
      tracked.x = screen.x;
      tracked.y = screen.y;
    }

    // Active pinch/pan gesture takes priority.
    if (this.gesture && this.pointers.size >= 2) {
      this.updateGesture();
      return;
    }

    // Pan (mouse middle/right, or one-finger touch on empty space).
    if (this.opType === "pan") {
      const dx = screen.x - this.cursorScreen.x;
      const dy = screen.y - this.cursorScreen.y;
      this.vp.panByScreen(dx, dy);
      this.cursorScreen = screen;
      this.requestRender();
      return;
    }

    this.updateCursor(screen);
    this.onStatusChange?.();
    if (this.opStart && distance(screen, this.opStart) > this.tapSlop) this.opMoved = true;

    if (this.opType === "tool" || this.opType === "tool-tap") {
      this.tool?.onMove(this.toolPoint(), this.ctx());
      this.requestRender();
      return;
    }

    if (this.opType === "marquee" && this.marquee && this.opStart) {
      this.marquee.x1 = screen.x;
      this.marquee.y1 = screen.y;
      this.marquee.crossing = screen.x < this.opStart.x;
      this.requestRender();
      return;
    }

    if (this.opType === "drag" && this.dragBase) {
      if (this.opMoved || this.dragging) {
        this.dragging = true;
        const d = sub(this.effectivePoint(), this.dragBase);
        this.preview = this.dragOriginals.map((en) => translateEntity(en, d));
        this.requestRender();
      }
      return;
    }

    // Hover feedback (mouse) in select mode.
    if (!this.opType && !this.tool) {
      const hit = this.hitTest(this.cursorRaw);
      if (hit !== this.hover) {
        this.hover = hit;
        this.requestRender();
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.pointers.delete(e.pointerId);

    // Winding down a gesture: wait until all involved fingers lift before
    // resuming single-pointer interaction, so a leftover finger doesn't jump.
    if (this.gesture) {
      if (this.pointers.size < 2) {
        this.gesture = null;
        this.opType = null;
        this.opStart = null;
        this.opMoved = false;
      }
      return;
    }

    switch (this.opType) {
      case "tool-tap":
        if (!this.opMoved && this.tool) {
          const p = this.toolPoint();
          this.tool.onPoint(p, this.ctx());
          this.lastPoint = p;
        }
        break;
      case "marquee":
        this.finalizeMarquee();
        break;
      case "drag":
        if (this.dragging && this.dragBase) {
          const d = sub(this.effectivePoint(), this.dragBase);
          if (d.x !== 0 || d.y !== 0) {
            const moved = this.dragOriginals.map((en) => translateEntity(en, d));
            this.history.execute(new ReplaceEntities(this.dragOriginals, moved));
          }
        }
        this.preview = [];
        break;
    }

    this.dragging = false;
    this.dragBase = null;
    this.dragOriginals = [];
    this.opType = null;
    this.opStart = null;
    this.opMoved = false;
    this.requestRender();
  }

  private finalizeMarquee(): void {
    if (!this.marquee) return;
    const a = this.vp.screenToWorld({ x: this.marquee.x0, y: this.marquee.y0 });
    const b = this.vp.screenToWorld({ x: this.marquee.x1, y: this.marquee.y1 });
    const region: Bounds = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
    const crossing = this.marquee.crossing;
    for (const id of this.doc.queryIds(region)) {
      const en = this.doc.get(id);
      if (!en || !this.doc.isLayerVisible(en.layer)) continue;
      const eb = entityBounds(en);
      const inside = crossing
        ? boundsIntersect(eb, region)
        : eb.minX >= region.minX &&
          eb.maxX <= region.maxX &&
          eb.minY >= region.minY &&
          eb.maxY <= region.maxY;
      if (inside) this.selection.add(id);
    }
    this.marquee = null;
    this.onStatusChange?.();
  }

  // --- multi-touch gesture (pinch zoom + two-finger pan) --------------------

  private twoPointers(): Array<{ x: number; y: number }> {
    return [...this.pointers.values()].slice(0, 2);
  }

  private beginGesture(): void {
    const [a, b] = this.twoPointers();
    if (!a || !b) return;
    this.gesture = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  private updateGesture(): void {
    if (!this.gesture) return;
    const [a, b] = this.twoPointers();
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Two-finger pan by the midpoint delta, then pinch-zoom about the new midpoint.
    this.vp.panByScreen(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
    if (this.gesture.dist > 1) this.vp.zoomAt(mid, dist / this.gesture.dist);
    this.gesture.dist = dist;
    this.gesture.mid = mid;
    this.requestRender();
  }

  private cancelSingleOp(): void {
    this.marquee = null;
    this.dragging = false;
    this.dragBase = null;
    this.dragOriginals = [];
    this.preview = [];
    this.opType = null;
    this.opStart = null;
    this.opMoved = false;
  }

  /** Nearest entity within a screen-pixel tolerance of the world point. */
  private hitTest(world: Vec2, pixelTol = 8): string | null {
    const tol = this.vp.toWorldLength(pixelTol);
    const region: Bounds = {
      minX: world.x - tol,
      minY: world.y - tol,
      maxX: world.x + tol,
      maxY: world.y + tol,
    };
    let best: string | null = null;
    let bestDist = tol;
    for (const id of this.doc.queryIds(region)) {
      const e = this.doc.get(id);
      if (!e || !this.doc.isLayerVisible(e.layer) || this.doc.isLayerLocked(e.layer)) continue;
      const d = distanceToEntity(e, world);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // --- keyboard & command line ---------------------------------------------

  handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (this.tool) this.tool.onCancel(this.ctx());
      else {
        this.selection.clear();
        this.onStatusChange?.();
      }
      this.setTool(null);
      this.requestRender();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      this.eraseSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      this.history.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      this.history.redo();
      return;
    }
    if (e.key === "F8") {
      e.preventDefault();
      this.ortho = !this.ortho;
      this.onStatusChange?.();
      return;
    }
  }

  /** Process a command-line submission (coordinate or command keyword). */
  submitCommandLine(raw: string): void {
    const parsed = parseInput(raw);

    if (parsed.kind === "empty") {
      if (this.tool?.onEnter) this.tool.onEnter(this.ctx());
      return;
    }

    if (parsed.kind === "command") {
      // Let the active tool consume free text (radius, text content, keyword).
      if (this.tool?.onText && this.tool.onText(parsed.text, this.ctx())) {
        this.lastPoint = this.effectivePoint();
        return;
      }
      this.runCommand(parsed.text);
      return;
    }

    // Coordinate input -> feed the active tool a committed point.
    const ref = this.lastPoint;
    const point = resolvePoint(parsed, ref);
    if (point && this.tool) {
      this.tool.onPoint(point, this.ctx());
      this.lastPoint = point;
      this.requestRender();
    }
  }

  // Registered command handlers set by main.ts (file ops etc.).
  commandHandlers: Record<string, () => void> = {};

  runCommand(text: string): void {
    const cmd = text.trim().toUpperCase();
    if (this.commandHandlers[cmd]) {
      this.commandHandlers[cmd]();
      return;
    }
    // Unknown command — surface it briefly.
    this.onPromptChange?.(`不明なコマンド: ${text}`);
  }

  eraseSelection(): void {
    if (this.selection.size === 0) return;
    const items = [...this.selection]
      .map((id) => this.doc.get(id))
      .filter((e): e is Entity => !!e);
    this.history.execute(new RemoveEntities(items));
    this.selection.clear();
    this.onStatusChange?.();
    this.requestRender();
  }

  clearSelection(): void {
    this.selection.clear();
    this.onStatusChange?.();
    this.requestRender();
  }

  getSelectionCount(): number {
    return this.selection.size;
  }

  /** Entities currently selected (for the properties panel). */
  selectedEntities(): Entity[] {
    return [...this.selection]
      .map((id) => this.doc.get(id))
      .filter((e): e is Entity => !!e);
  }

  /** Commit an edited version of the given entities via the history. */
  commitEntityEdit(before: Entity[], after: Entity[]): void {
    if (before.length === 0) return;
    this.history.execute(new ReplaceEntities(before, after));
  }

  cursorWorldReadout(): Vec2 {
    return this.snapResult?.point ?? this.cursorRaw;
  }

  replaceDocument(doc: CadDocument): void {
    this.doc = doc;
    this.history = new History(this.doc);
    this.history.onChange = () => {
      this.onStatusChange?.();
      this.requestRender();
      this.refresh3D();
    };
    this.renderer = new Renderer(this.canvas, this.doc, this.vp);
    this.snap = new SnapEngine(this.doc, this.vp);
    this.selection.clear();
    this.preview = [];
    this.doc.onChange(() => {
      this.onStatusChange?.();
      this.requestRender();
      this.refresh3D();
    });
    if (this.viewer3d) {
      // Point a fresh viewer at the new document.
      this.viewer3d.dispose();
      this.viewer3d = null;
      this.viewerPromise = null;
      if (this.mode === "3d") void this.ensureViewer().then((v) => v.activate());
    }
    this.zoomExtents();
    this.onStatusChange?.();
  }
}
