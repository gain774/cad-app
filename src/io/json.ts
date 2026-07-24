import { CadDocument, type Layer } from "../core/model/Document.ts";
import type { Entity } from "../core/model/entities.ts";

interface CadFile {
  format: "cad-app";
  version: 1;
  layers: Layer[];
  activeLayer: string;
  entities: Entity[];
}

/** Serialize the full document (native format, lossless). */
export function exportJson(doc: CadDocument): string {
  const file: CadFile = {
    format: "cad-app",
    version: 1,
    layers: doc.layers,
    activeLayer: doc.activeLayer,
    entities: [...doc.all()],
  };
  return JSON.stringify(file, null, 2);
}

/** Parse a native document file. Throws on an unrecognized shape. */
export function importJson(text: string): CadDocument {
  const data = JSON.parse(text) as Partial<CadFile>;
  if (data.format !== "cad-app") {
    throw new Error("対応していないファイル形式です");
  }
  const doc = new CadDocument();
  doc.clear();
  if (Array.isArray(data.layers)) {
    doc.layers = data.layers.map((l) => ({
      name: l.name,
      color: l.color,
      visible: l.visible ?? true,
      locked: l.locked ?? false,
      extrudeMode: l.extrudeMode ?? "wall",
      height: l.height ?? 100,
      elevation: l.elevation ?? 0,
    }));
  }
  doc.activeLayer = data.activeLayer && doc.getLayer(data.activeLayer)
    ? data.activeLayer
    : doc.layers[0]?.name ?? "0";
  for (const e of data.entities ?? []) {
    doc.add(e, true);
  }
  doc.notify();
  return doc;
}
