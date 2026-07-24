import { CadDocument } from "../core/model/Document.ts";
import {
  newId,
  type ArcEntity,
  type CircleEntity,
  type Entity,
  type LineEntity,
  type PolylineEntity,
  type TextEntity,
} from "../core/model/entities.ts";
import { DEG, RAD } from "../core/math/geometry.ts";

// ---------------------------------------------------------------------------
// AutoCAD Color Index (ACI) — the first 16 standard colors, enough for
// round-tripping most drawings. Index 0/256 mean ByBlock/ByLayer.
// ---------------------------------------------------------------------------
const ACI: Record<number, string> = {
  1: "#ff0000",
  2: "#ffff00",
  3: "#00ff00",
  4: "#00ffff",
  5: "#0000ff",
  6: "#ff00ff",
  7: "#ffffff",
  8: "#808080",
  9: "#c0c0c0",
};

function hexToAci(hex: string | null): number {
  if (!hex) return 256; // ByLayer
  const lower = hex.toLowerCase();
  for (const [k, v] of Object.entries(ACI)) {
    if (v === lower) return Number(k);
  }
  return 256;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Serialize a document to ASCII DXF (R12-compatible entity set). */
export function exportDxf(doc: CadDocument): string {
  const out: string[] = [];
  const w = (code: number, value: string | number) => {
    out.push(String(code));
    out.push(typeof value === "number" ? formatNum(value) : value);
  };

  // Minimal header.
  w(0, "SECTION");
  w(2, "HEADER");
  w(9, "$ACADVER");
  w(1, "AC1009");
  w(0, "ENDSEC");

  // Layer table.
  w(0, "SECTION");
  w(2, "TABLES");
  w(0, "TABLE");
  w(2, "LAYER");
  w(70, doc.layers.length);
  for (const layer of doc.layers) {
    w(0, "LAYER");
    w(2, layer.name);
    w(70, layer.locked ? 4 : 0);
    w(62, (layer.visible ? 1 : -1) * (hexToAci(layer.color) === 256 ? 7 : hexToAci(layer.color)));
    w(6, "CONTINUOUS");
  }
  w(0, "ENDTAB");
  w(0, "ENDSEC");

  // Entities.
  w(0, "SECTION");
  w(2, "ENTITIES");
  for (const e of doc.all()) {
    writeEntity(w, e);
  }
  w(0, "ENDSEC");
  w(0, "EOF");

  return out.join("\r\n") + "\r\n";
}

function writeEntity(w: (c: number, v: string | number) => void, e: Entity): void {
  const common = () => {
    w(8, e.layer);
    const aci = hexToAci(e.color);
    if (aci !== 256) w(62, aci);
  };
  switch (e.type) {
    case "line":
      w(0, "LINE");
      common();
      w(10, e.a.x);
      w(20, e.a.y);
      w(30, 0);
      w(11, e.b.x);
      w(21, e.b.y);
      w(31, 0);
      break;
    case "polyline":
      w(0, "LWPOLYLINE");
      common();
      w(90, e.points.length);
      w(70, e.closed ? 1 : 0);
      for (const p of e.points) {
        w(10, p.x);
        w(20, p.y);
      }
      break;
    case "circle":
      w(0, "CIRCLE");
      common();
      w(10, e.center.x);
      w(20, e.center.y);
      w(30, 0);
      w(40, e.radius);
      break;
    case "arc":
      w(0, "ARC");
      common();
      w(10, e.center.x);
      w(20, e.center.y);
      w(30, 0);
      w(40, e.radius);
      w(50, e.startAngle * RAD);
      w(51, e.endAngle * RAD);
      break;
    case "text":
      w(0, "TEXT");
      common();
      w(10, e.position.x);
      w(20, e.position.y);
      w(30, 0);
      w(40, e.height);
      w(1, e.content);
      if (e.rotation) w(50, e.rotation * RAD);
      break;
  }
}

function formatNum(n: number): string {
  if (!isFinite(n)) return "0";
  // DXF likes plain decimals; trim needless precision.
  return Number(n.toFixed(6)).toString();
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

interface Pair {
  code: number;
  value: string;
}

/** Parse DXF text into a document. Handles the common R12 entity set. */
export function importDxf(text: string): CadDocument {
  const pairs = tokenize(text);
  const doc = new CadDocument();
  const layersSeen = new Set<string>(["0"]);

  let i = 0;
  // Seek to ENTITIES section.
  while (i < pairs.length) {
    if (pairs[i].code === 2 && pairs[i].value.toUpperCase() === "LAYER") {
      i = readLayerTable(pairs, i, doc, layersSeen);
      continue;
    }
    if (pairs[i].code === 2 && pairs[i].value.toUpperCase() === "ENTITIES") {
      i++;
      break;
    }
    i++;
  }

  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && p.value.toUpperCase() === "ENDSEC") break;
    if (p.code === 0) {
      const [entity, next] = readEntity(pairs, i, layersSeen);
      if (entity) {
        if (!doc.getLayer(entity.layer)) doc.addLayer(entity.layer);
        doc.add(entity, true);
      }
      i = next;
    } else {
      i++;
    }
  }
  doc.notify();
  return doc;
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) {
      i -= 1; // resync on stray line
      continue;
    }
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

function readLayerTable(
  pairs: Pair[],
  start: number,
  doc: CadDocument,
  seen: Set<string>,
): number {
  let i = start;
  while (i < pairs.length) {
    if (pairs[i].code === 0 && pairs[i].value.toUpperCase() === "LAYER") {
      let name = "0";
      let color = 7;
      let j = i + 1;
      for (; j < pairs.length && pairs[j].code !== 0; j++) {
        if (pairs[j].code === 2) name = pairs[j].value.trim();
        if (pairs[j].code === 62) color = parseInt(pairs[j].value, 10);
      }
      if (name && !seen.has(name)) {
        doc.addLayer(name, ACI[Math.abs(color)] ?? "#c8c8c8");
        seen.add(name);
      } else if (name === "0") {
        const l = doc.getLayer("0");
        if (l) l.color = ACI[Math.abs(color)] ?? l.color;
      }
      i = j;
      continue;
    }
    if (pairs[i].code === 0 && pairs[i].value.toUpperCase() === "ENDTAB") {
      return i + 1;
    }
    i++;
  }
  return i;
}

function readEntity(pairs: Pair[], start: number, seen: Set<string>): [Entity | null, number] {
  const type = pairs[start].value.toUpperCase();
  const data = new Map<number, string[]>();
  let i = start + 1;
  for (; i < pairs.length && pairs[i].code !== 0; i++) {
    const arr = data.get(pairs[i].code) ?? [];
    arr.push(pairs[i].value);
    data.set(pairs[i].code, arr);
  }
  const num = (code: number, idx = 0, def = 0): number => {
    const v = data.get(code)?.[idx];
    const n = v !== undefined ? parseFloat(v) : NaN;
    return isFinite(n) ? n : def;
  };
  const str = (code: number, def = "") => data.get(code)?.[0] ?? def;
  const layer = str(8, "0").trim() || "0";
  seen.add(layer);
  const aci = data.has(62) ? parseInt(data.get(62)![0], 10) : 256;
  const color = aci !== 256 && aci !== 0 ? ACI[Math.abs(aci)] ?? null : null;
  const common = { id: newId(), layer, color };

  switch (type) {
    case "LINE": {
      const e: LineEntity = {
        ...common,
        type: "line",
        a: { x: num(10), y: num(20) },
        b: { x: num(11), y: num(21) },
      };
      return [e, i];
    }
    case "CIRCLE": {
      const e: CircleEntity = {
        ...common,
        type: "circle",
        center: { x: num(10), y: num(20) },
        radius: num(40, 0, 1),
      };
      return [e, i];
    }
    case "ARC": {
      const e: ArcEntity = {
        ...common,
        type: "arc",
        center: { x: num(10), y: num(20) },
        radius: num(40, 0, 1),
        startAngle: num(50) * DEG,
        endAngle: num(51) * DEG,
      };
      return [e, i];
    }
    case "LWPOLYLINE": {
      const xs = data.get(10) ?? [];
      const ys = data.get(20) ?? [];
      const points = xs.map((x, k) => ({ x: parseFloat(x), y: parseFloat(ys[k] ?? "0") }));
      const closed = (num(70) & 1) === 1;
      const e: PolylineEntity = { ...common, type: "polyline", points, closed };
      return [e, i];
    }
    case "TEXT":
    case "MTEXT": {
      const e: TextEntity = {
        ...common,
        type: "text",
        position: { x: num(10), y: num(20) },
        content: (str(1) || "").replace(/\\[A-Za-z][^;]*;/g, ""),
        height: num(40, 0, 10),
        rotation: num(50) * DEG,
      };
      return [e, i];
    }
    case "POLYLINE": {
      // Old-style polyline: vertices follow as VERTEX entities until SEQEND.
      const closed = (num(70) & 1) === 1;
      const points: { x: number; y: number }[] = [];
      let j = i;
      while (j < pairs.length) {
        if (pairs[j].code === 0) {
          const t = pairs[j].value.toUpperCase();
          if (t === "VERTEX") {
            let vx = 0;
            let vy = 0;
            let k = j + 1;
            for (; k < pairs.length && pairs[k].code !== 0; k++) {
              if (pairs[k].code === 10) vx = parseFloat(pairs[k].value);
              if (pairs[k].code === 20) vy = parseFloat(pairs[k].value);
            }
            points.push({ x: vx, y: vy });
            j = k;
            continue;
          }
          if (t === "SEQEND") {
            j += 1;
            break;
          }
          break;
        }
        j++;
      }
      const e: PolylineEntity = { ...common, type: "polyline", points, closed };
      return [e, j];
    }
    default:
      // Unknown entity: skip it but keep parsing.
      return [null, i];
  }
}
