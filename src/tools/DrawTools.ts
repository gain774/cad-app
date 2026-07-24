import type { Tool, EditorContext } from "./Tool.ts";
import type { Vec2 } from "../core/math/Vec2.ts";
import { distance } from "../core/math/Vec2.ts";
import { AddEntities } from "../core/commands/History.ts";
import {
  newId,
  type ArcEntity,
  type CircleEntity,
  type Entity,
  type LineEntity,
  type PolylineEntity,
  type TextEntity,
} from "../core/model/entities.ts";

function base(ctx: EditorContext) {
  return { id: newId(), layer: ctx.activeLayer(), color: null };
}

export class LineTool implements Tool {
  name = "line";
  private start: Vec2 | null = null;

  activate(ctx: EditorContext): void {
    this.start = null;
    ctx.setPrompt("線: 始点を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.start) {
      this.start = p;
      ctx.setPrompt("線: 次の点を指定 (Enterで終了)");
      return;
    }
    const e: LineEntity = { ...base(ctx), type: "line", a: this.start, b: p };
    ctx.history.execute(new AddEntities([e]));
    // Chain: the endpoint becomes the next start (AutoCAD LINE behavior).
    this.start = p;
    ctx.setPreview([]);
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.start) return;
    const preview: LineEntity = { ...base(ctx), type: "line", a: this.start, b: p };
    ctx.setPreview([preview]);
  }
  onEnter(ctx: EditorContext): void {
    this.start = null;
    ctx.setPreview([]);
    ctx.setPrompt("線: 始点を指定");
  }
  onCancel(ctx: EditorContext): void {
    this.start = null;
    ctx.setPreview([]);
    ctx.setPrompt("線: 始点を指定");
  }
}

export class PolylineTool implements Tool {
  name = "polyline";
  private points: Vec2[] = [];

  activate(ctx: EditorContext): void {
    this.points = [];
    ctx.setPrompt("連続線: 始点を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    this.points.push(p);
    ctx.setPrompt("連続線: 次の点を指定 (Enterで確定 / C=閉じる)");
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (this.points.length === 0) return;
    const pts = [...this.points, p];
    const preview: PolylineEntity = {
      ...base(ctx),
      type: "polyline",
      points: pts,
      closed: false,
    };
    ctx.setPreview([preview]);
  }
  onText(text: string, ctx: EditorContext): boolean {
    if (text.trim().toLowerCase() === "c") {
      this.commit(ctx, true);
      return true;
    }
    return false;
  }
  onEnter(ctx: EditorContext): void {
    this.commit(ctx, false);
  }
  private commit(ctx: EditorContext, closed: boolean): void {
    if (this.points.length >= 2) {
      const e: PolylineEntity = {
        ...base(ctx),
        type: "polyline",
        points: this.points.slice(),
        closed,
      };
      ctx.history.execute(new AddEntities([e]));
    }
    this.points = [];
    ctx.setPreview([]);
    ctx.setPrompt("連続線: 始点を指定");
  }
  onCancel(ctx: EditorContext): void {
    this.points = [];
    ctx.setPreview([]);
    ctx.setPrompt("連続線: 始点を指定");
  }
}

export class RectTool implements Tool {
  name = "rect";
  private start: Vec2 | null = null;

  activate(ctx: EditorContext): void {
    this.start = null;
    ctx.setPrompt("矩形: 1つ目の角を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  private makeRect(a: Vec2, b: Vec2, ctx: EditorContext): PolylineEntity {
    return {
      ...base(ctx),
      type: "polyline",
      points: [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ],
      closed: true,
    };
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.start) {
      this.start = p;
      ctx.setPrompt("矩形: 対角の角を指定");
      return;
    }
    ctx.history.execute(new AddEntities([this.makeRect(this.start, p, ctx)]));
    this.start = null;
    ctx.setPreview([]);
    ctx.setPrompt("矩形: 1つ目の角を指定");
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.start) return;
    ctx.setPreview([this.makeRect(this.start, p, ctx)]);
  }
  onCancel(ctx: EditorContext): void {
    this.start = null;
    ctx.setPreview([]);
    ctx.setPrompt("矩形: 1つ目の角を指定");
  }
}

export class CircleTool implements Tool {
  name = "circle";
  private center: Vec2 | null = null;

  activate(ctx: EditorContext): void {
    this.center = null;
    ctx.setPrompt("円: 中心を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.center) {
      this.center = p;
      ctx.setPrompt("円: 半径を指定 (数値入力可)");
      return;
    }
    const r = distance(this.center, p);
    if (r > 1e-9) this.emit(r, ctx);
  }
  private emit(radius: number, ctx: EditorContext): void {
    const e: CircleEntity = {
      ...base(ctx),
      type: "circle",
      center: this.center!,
      radius,
    };
    ctx.history.execute(new AddEntities([e]));
    this.center = null;
    ctx.setPreview([]);
    ctx.setPrompt("円: 中心を指定");
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.center) return;
    const r = distance(this.center, p);
    const preview: CircleEntity = {
      ...base(ctx),
      type: "circle",
      center: this.center,
      radius: r,
    };
    ctx.setPreview([preview]);
  }
  onText(text: string, ctx: EditorContext): boolean {
    if (!this.center) return false;
    const r = parseFloat(text);
    if (isFinite(r) && r > 0) {
      this.emit(r, ctx);
      return true;
    }
    return false;
  }
  onCancel(ctx: EditorContext): void {
    this.center = null;
    ctx.setPreview([]);
    ctx.setPrompt("円: 中心を指定");
  }
}

/** Arc by center, start point, end point (CCW). */
export class ArcTool implements Tool {
  name = "arc";
  private center: Vec2 | null = null;
  private startPt: Vec2 | null = null;

  activate(ctx: EditorContext): void {
    this.center = null;
    this.startPt = null;
    ctx.setPrompt("円弧: 中心を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.center) {
      this.center = p;
      ctx.setPrompt("円弧: 始点を指定");
      return;
    }
    if (!this.startPt) {
      this.startPt = p;
      ctx.setPrompt("円弧: 終点(角度)を指定");
      return;
    }
    const arc = this.makeArc(p);
    if (arc) {
      ctx.history.execute(new AddEntities([{ ...base(ctx), ...arc }]));
    }
    this.center = null;
    this.startPt = null;
    ctx.setPreview([]);
    ctx.setPrompt("円弧: 中心を指定");
  }
  private makeArc(endRef: Vec2): Omit<ArcEntity, "id" | "layer" | "color"> | null {
    if (!this.center || !this.startPt) return null;
    const radius = distance(this.center, this.startPt);
    const startAngle = Math.atan2(this.startPt.y - this.center.y, this.startPt.x - this.center.x);
    const endAngle = Math.atan2(endRef.y - this.center.y, endRef.x - this.center.x);
    return { type: "arc", center: this.center, radius, startAngle, endAngle };
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.center) return;
    if (!this.startPt) {
      const r = distance(this.center, p);
      ctx.setPreview([
        { ...base(ctx), type: "circle", center: this.center, radius: r } as Entity,
      ]);
      return;
    }
    const arc = this.makeArc(p);
    if (arc) ctx.setPreview([{ ...base(ctx), ...arc } as Entity]);
  }
  onCancel(ctx: EditorContext): void {
    this.center = null;
    this.startPt = null;
    ctx.setPreview([]);
    ctx.setPrompt("円弧: 中心を指定");
  }
}

export class TextTool implements Tool {
  name = "text";
  private pos: Vec2 | null = null;
  private height = 20;

  activate(ctx: EditorContext): void {
    this.pos = null;
    ctx.setPrompt("文字: 挿入位置を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    this.pos = p;
    ctx.setPrompt("文字: 内容を入力してEnter (高さ=" + this.height + ")");
  }
  onMove(): void {
    /* no preview until placed */
  }
  onText(text: string, ctx: EditorContext): boolean {
    if (!this.pos) return false;
    if (text.length === 0) return false;
    const e: TextEntity = {
      ...base(ctx),
      type: "text",
      position: this.pos,
      content: text,
      height: this.height,
      rotation: 0,
    };
    ctx.history.execute(new AddEntities([e]));
    this.pos = null;
    ctx.setPrompt("文字: 挿入位置を指定");
    return true;
  }
  onCancel(ctx: EditorContext): void {
    this.pos = null;
    ctx.setPreview([]);
    ctx.setPrompt("文字: 挿入位置を指定");
  }
}
