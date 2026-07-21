import type { Tool, EditorContext } from "./Tool.ts";
import type { Vec2 } from "../core/math/Vec2.ts";
import { sub } from "../core/math/Vec2.ts";
import { AddEntities, ReplaceEntities } from "../core/commands/History.ts";
import { newId, translateEntity, type Entity } from "../core/model/entities.ts";

/** Move the current selection by a base point → destination vector. */
export class MoveTool implements Tool {
  name = "move";
  private base: Vec2 | null = null;
  private targets: Entity[] = [];

  activate(ctx: EditorContext): void {
    this.base = null;
    this.targets = [...ctx.getSelection()]
      .map((id) => ctx.doc.get(id))
      .filter((e): e is Entity => !!e);
    if (this.targets.length === 0) {
      ctx.setPrompt("移動: 先にオブジェクトを選択してください");
      ctx.finishToSelect();
      return;
    }
    ctx.setPrompt("移動: 基点を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.base) {
      this.base = p;
      ctx.setPrompt("移動: 目的点を指定");
      return;
    }
    const d = sub(p, this.base);
    const moved = this.targets.map((e) => translateEntity(e, d));
    ctx.history.execute(new ReplaceEntities(this.targets, moved));
    ctx.setPreview([]);
    ctx.finishToSelect();
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.base) return;
    const d = sub(p, this.base);
    ctx.setPreview(this.targets.map((e) => translateEntity(e, d)));
  }
  onCancel(ctx: EditorContext): void {
    ctx.setPreview([]);
    ctx.finishToSelect();
  }
}

/** Copy the current selection; repeats until cancelled (AutoCAD COPY). */
export class CopyTool implements Tool {
  name = "copy";
  private base: Vec2 | null = null;
  private targets: Entity[] = [];

  activate(ctx: EditorContext): void {
    this.base = null;
    this.targets = [...ctx.getSelection()]
      .map((id) => ctx.doc.get(id))
      .filter((e): e is Entity => !!e);
    if (this.targets.length === 0) {
      ctx.setPrompt("複写: 先にオブジェクトを選択してください");
      ctx.finishToSelect();
      return;
    }
    ctx.setPrompt("複写: 基点を指定");
  }
  deactivate(ctx: EditorContext): void {
    ctx.setPreview([]);
  }
  onPoint(p: Vec2, ctx: EditorContext): void {
    if (!this.base) {
      this.base = p;
      ctx.setPrompt("複写: 目的点を指定 (連続複写可 / Escで終了)");
      return;
    }
    const d = sub(p, this.base);
    const copies = this.targets.map((e) => ({
      ...translateEntity(e, d),
      id: newId(),
    }));
    ctx.history.execute(new AddEntities(copies));
    // Stay in the command for repeated placement.
  }
  onMove(p: Vec2, ctx: EditorContext): void {
    if (!this.base) return;
    const d = sub(p, this.base);
    ctx.setPreview(
      this.targets.map((e) => ({ ...translateEntity(e, d), id: newId() })),
    );
  }
  onCancel(ctx: EditorContext): void {
    ctx.setPreview([]);
    ctx.finishToSelect();
  }
}
