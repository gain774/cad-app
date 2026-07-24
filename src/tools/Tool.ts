import type { CadDocument } from "../core/model/Document.ts";
import type { History } from "../core/commands/History.ts";
import type { Entity } from "../core/model/entities.ts";
import type { Vec2 } from "../core/math/Vec2.ts";

/** Services the editor exposes to tools. */
export interface EditorContext {
  doc: CadDocument;
  history: History;
  /** Currently active layer name for newly-created entities. */
  activeLayer(): string;
  /** Show a prompt string in the command line. */
  setPrompt(text: string): void;
  /** Replace the tool preview entities to be rendered this frame. */
  setPreview(entities: Entity[]): void;
  /** Request a redraw. */
  requestRender(): void;
  /** Snapped world position of the cursor (falls back to raw cursor). */
  cursorWorld(): Vec2;
  /** Set the selection set (used by edit tools). */
  setSelection(ids: Set<string>): void;
  getSelection(): Set<string>;
  /** Switch back to the select tool. */
  finishToSelect(): void;
}

/**
 * A tool interprets user input into drawing/editing actions. Most CAD tools
 * are click-driven: each committed point advances the tool's internal state.
 */
export interface Tool {
  readonly name: string;
  activate(ctx: EditorContext): void;
  deactivate(ctx: EditorContext): void;
  /** A committed point (mouse click or typed coordinate), already snapped. */
  onPoint(p: Vec2, ctx: EditorContext): void;
  /** Cursor moved to world point p (already snapped). */
  onMove(p: Vec2, ctx: EditorContext): void;
  /** Enter/return pressed with no coordinate (accept / finish). */
  onEnter?(ctx: EditorContext): void;
  /** Escape pressed — cancel current operation. */
  onCancel(ctx: EditorContext): void;
  /** Optional textual argument from the command line (e.g. a radius). */
  onText?(text: string, ctx: EditorContext): boolean;
}
