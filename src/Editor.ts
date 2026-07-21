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
  private panning = false;
  private dragging = false;
  private dragBase: Vec2 | null = null;
  private dragOriginals: Entity[] = [];
  private mouseDownScreen: Vec2 | null = null;

  snapSettings: SnapSettings = {
    grid: true,
    end: true,
    mid: true,
    center: true,
    intersect: true,
    gridSize: 10,
  };

  private renderScheduled = false;

  // UI callbacks (wired up by main.ts).
  onPromptChange: ((text: string) => void) | null = null;
  onStatusChange: (() => void) | null = null;
  onToolChange: ((name: string) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.doc, this.vp);
    this.snap = new SnapEngine(this.doc, this.vp);
    this.renderer.resize();
    this.vp.fit(this.doc.totalBounds());
    this.attachEvents();
    this.doc.onChange(() => {
      this.onStatusChange?.();
      this.requestRender();
    });
    this.history.onChange = () => {
      this.onStatusChange?.();
      this.requestRender();
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
        showGrid: true,
      });
    });
  }

  resize(): void {
    this.renderer.resize();
    this.requestRender();
  }

  zoomExtents(): void {
    const b = this.doc.totalBounds();
    this.vp.fit(b);
    this.requestRender();
  }

  // --- input ----------------------------------------------------------------

  private attachEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => this.onPointerMove(e));
    c.addEventListener("pointerup", (e) => this.onPointerUp(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private screenOf(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private updateCursor(screen: Vec2): void {
    this.cursorScreen = screen;
    this.cursorRaw = this.vp.screenToWorld(screen);
    this.snapResult = this.snap.resolve(this.cursorRaw, this.snapSettings);
  }

  /** The point the tools should use: snapped if available, else raw. */
  private effectivePoint(): Vec2 {
    return this.snapResult?.point ?? this.cursorRaw;
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

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const screen = this.screenOf(e);
    this.updateCursor(screen);
    this.mouseDownScreen = screen;

    // Middle button or right button => pan.
    if (e.button === 1 || e.button === 2) {
      this.panning = true;
      return;
    }
    if (e.button !== 0) return;

    if (this.tool) {
      this.tool.onPoint(this.effectivePoint(), this.ctx());
      this.lastPoint = this.effectivePoint();
      return;
    }

    // Select mode: decide between pick+drag and marquee.
    const hitId = this.hitTest(this.cursorRaw);
    if (hitId) {
      if (e.shiftKey) {
        if (this.selection.has(hitId)) this.selection.delete(hitId);
        else this.selection.add(hitId);
      } else if (!this.selection.has(hitId)) {
        this.selection.clear();
        this.selection.add(hitId);
      }
      // Prepare a possible drag-move of the current selection.
      this.dragBase = this.effectivePoint();
      this.dragOriginals = [...this.selection]
        .map((id) => this.doc.get(id))
        .filter((x): x is Entity => !!x);
      this.onStatusChange?.();
    } else {
      if (!e.shiftKey) this.selection.clear();
      this.marquee = {
        x0: screen.x,
        y0: screen.y,
        x1: screen.x,
        y1: screen.y,
        crossing: false,
      };
    }
    this.requestRender();
  }

  private onPointerMove(e: PointerEvent): void {
    const screen = this.screenOf(e);

    if (this.panning && this.mouseDownScreen) {
      const dx = screen.x - this.cursorScreen.x;
      const dy = screen.y - this.cursorScreen.y;
      this.vp.panByScreen(dx, dy);
      this.cursorScreen = screen;
      this.requestRender();
      return;
    }

    this.updateCursor(screen);
    this.onStatusChange?.();

    if (this.tool) {
      this.tool.onMove(this.effectivePoint(), this.ctx());
      this.requestRender();
      return;
    }

    // Marquee update.
    if (this.marquee && this.mouseDownScreen) {
      this.marquee.x1 = screen.x;
      this.marquee.y1 = screen.y;
      this.marquee.crossing = screen.x < this.mouseDownScreen.x;
      this.requestRender();
      return;
    }

    // Drag-move of selection.
    if (this.dragBase && this.mouseDownScreen) {
      const movedFar =
        distance(screen, this.mouseDownScreen) > 3 || this.dragging;
      if (movedFar) {
        this.dragging = true;
        const d = sub(this.effectivePoint(), this.dragBase);
        this.preview = this.dragOriginals.map((en) => translateEntity(en, d));
        this.requestRender();
      }
      return;
    }

    // Hover feedback in select mode.
    const hit = this.hitTest(this.cursorRaw);
    if (hit !== this.hover) {
      this.hover = hit;
      this.requestRender();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (this.panning) {
      this.panning = false;
      this.mouseDownScreen = null;
      return;
    }

    // Finalize marquee selection.
    if (this.marquee && this.mouseDownScreen) {
      const a = this.vp.screenToWorld({ x: this.marquee.x0, y: this.marquee.y0 });
      const b = this.vp.screenToWorld({ x: this.marquee.x1, y: this.marquee.y1 });
      const region: Bounds = {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      };
      const crossing = this.marquee.crossing;
      const ids = this.doc.queryIds(region);
      for (const id of ids) {
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
      this.mouseDownScreen = null;
      this.onStatusChange?.();
      this.requestRender();
      return;
    }

    // Commit a drag-move.
    if (this.dragging && this.dragBase) {
      const d = sub(this.effectivePoint(), this.dragBase);
      if (d.x !== 0 || d.y !== 0) {
        const moved = this.dragOriginals.map((en) => translateEntity(en, d));
        this.history.execute(new ReplaceEntities(this.dragOriginals, moved));
      }
    }

    this.dragging = false;
    this.dragBase = null;
    this.dragOriginals = [];
    this.preview = [];
    this.mouseDownScreen = null;
    this.requestRender();
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

  cursorWorldReadout(): Vec2 {
    return this.snapResult?.point ?? this.cursorRaw;
  }

  replaceDocument(doc: CadDocument): void {
    this.doc = doc;
    this.history = new History(this.doc);
    this.history.onChange = () => {
      this.onStatusChange?.();
      this.requestRender();
    };
    this.renderer = new Renderer(this.canvas, this.doc, this.vp);
    this.snap = new SnapEngine(this.doc, this.vp);
    this.selection.clear();
    this.preview = [];
    this.doc.onChange(() => {
      this.onStatusChange?.();
      this.requestRender();
    });
    this.zoomExtents();
    this.onStatusChange?.();
  }
}
