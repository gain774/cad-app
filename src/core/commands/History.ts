import type { CadDocument } from "../model/Document.ts";
import type { Entity } from "../model/entities.ts";

/** A reversible edit to the document. */
export interface Command {
  label: string;
  apply(doc: CadDocument): void;
  revert(doc: CadDocument): void;
}

export class AddEntities implements Command {
  label = "追加";
  constructor(private items: Entity[]) {}
  apply(doc: CadDocument): void {
    for (const e of this.items) doc.add(e, true);
    doc.notify();
  }
  revert(doc: CadDocument): void {
    for (const e of this.items) doc.remove(e.id, true);
    doc.notify();
  }
}

export class RemoveEntities implements Command {
  label = "削除";
  constructor(private items: Entity[]) {}
  apply(doc: CadDocument): void {
    for (const e of this.items) doc.remove(e.id, true);
    doc.notify();
  }
  revert(doc: CadDocument): void {
    for (const e of this.items) doc.add(e, true);
    doc.notify();
  }
}

export class ReplaceEntities implements Command {
  label = "変更";
  constructor(private before: Entity[], private after: Entity[]) {}
  apply(doc: CadDocument): void {
    for (const e of this.after) doc.replace(e, true);
    doc.notify();
  }
  revert(doc: CadDocument): void {
    for (const e of this.before) doc.replace(e, true);
    doc.notify();
  }
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit = 200;
  onChange: (() => void) | null = null;

  constructor(private doc: CadDocument) {}

  /** Execute a command and push it onto the undo stack. */
  execute(cmd: Command): void {
    cmd.apply(this.doc);
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  /** Record an already-applied change without re-applying it. */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.revert(this.doc);
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.apply(this.doc);
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.();
  }
}
