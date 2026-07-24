import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CadDocument } from "../core/model/Document.ts";
import type { Entity } from "../core/model/entities.ts";
import { pointOnCircle } from "../core/model/entities.ts";
import { normalizeAngle } from "../core/math/geometry.ts";
import type { Vec2 } from "../core/math/Vec2.ts";

/** Result of converting the 2D document into 3D-ready geometry, grouped by color. */
export interface Built3D {
  /** Merged solid geometry per color (extruded walls / plates). */
  solids: Map<string, THREE.BufferGeometry>;
  /** Flat line segments per color (for "none" layers, drawn on their elevation). */
  lines: Map<string, number[]>;
}

/** Normalize a geometry so heterogeneous sources can be merged together. */
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  n.deleteAttribute("uv1");
  n.deleteAttribute("uv2");
  if (!n.getAttribute("normal")) n.computeVertexNormals();
  return n;
}

/** A vertical quad (wall) between two points, from z0 to z0+height. */
function wallQuad(a: Vec2, b: Vec2, z0: number, height: number): THREE.BufferGeometry {
  const z1 = z0 + height;
  // Two triangles: (a0,b0,b1) and (a0,b1,a1).
  const p = [
    a.x, a.y, z0,
    b.x, b.y, z0,
    b.x, b.y, z1,
    a.x, a.y, z0,
    b.x, b.y, z1,
    a.x, a.y, z1,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

function arcWall(
  center: Vec2,
  radius: number,
  start: number,
  end: number,
  z0: number,
  height: number,
): THREE.BufferGeometry {
  let e = normalizeAngle(end);
  const s = normalizeAngle(start);
  if (e < s) e += Math.PI * 2;
  const sweep = e - s;
  const segs = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 64));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < segs; i++) {
    const a = pointOnCircle(center, radius, s + (sweep * i) / segs);
    const b = pointOnCircle(center, radius, s + (sweep * (i + 1)) / segs);
    parts.push(wallQuad(a, b, z0, height));
  }
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

/** Extrude a closed 2D polygon into a solid prism (plate mode). */
function prism(points: Vec2[], z0: number, height: number): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  // ExtrudeGeometry builds on the XY plane extruding +Z; lift to the elevation.
  g.translate(0, 0, z0);
  return g;
}

function segmentsOf(e: Entity, closed: boolean): Array<[Vec2, Vec2]> {
  if (e.type === "line") return [[e.a, e.b]];
  if (e.type === "polyline") {
    const segs: Array<[Vec2, Vec2]> = [];
    const n = e.points.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) segs.push([e.points[i], e.points[(i + 1) % n]]);
    return segs;
  }
  return [];
}

/** Convert the whole document into merged 3D geometry grouped by color. */
export function buildScene3D(doc: CadDocument): Built3D {
  const solidParts = new Map<string, THREE.BufferGeometry[]>();
  const lines = new Map<string, number[]>();

  const pushSolid = (color: string, g: THREE.BufferGeometry | null) => {
    if (!g) return;
    const arr = solidParts.get(color) ?? [];
    arr.push(normalize(g));
    solidParts.set(color, arr);
  };
  const pushLine = (color: string, a: Vec2, b: Vec2, z: number) => {
    const arr = lines.get(color) ?? [];
    arr.push(a.x, a.y, z, b.x, b.y, z);
    lines.set(color, arr);
  };

  for (const e of doc.all()) {
    const layer = doc.getLayer(e.layer);
    if (!layer || !layer.visible) continue;
    const color = doc.effectiveColor(e);
    const mode = layer.extrudeMode;
    const h = layer.height;
    const z0 = layer.elevation;

    if (mode === "none" || e.type === "text") {
      // Lay the 2D geometry flat at the layer elevation.
      if (e.type === "circle" || e.type === "arc") {
        const start = e.type === "arc" ? e.startAngle : 0;
        const end = e.type === "arc" ? e.endAngle : Math.PI * 2;
        let ee = normalizeAngle(end);
        const ss = normalizeAngle(start);
        if (ee <= ss) ee += Math.PI * 2;
        const segs = 48;
        for (let i = 0; i < segs; i++) {
          const a = pointOnCircle(e.center, e.radius, ss + ((ee - ss) * i) / segs);
          const b = pointOnCircle(e.center, e.radius, ss + ((ee - ss) * (i + 1)) / segs);
          pushLine(color, a, b, z0);
        }
      } else {
        for (const [a, b] of segmentsOf(e, e.type === "polyline" && e.closed)) {
          pushLine(color, a, b, z0);
        }
      }
      continue;
    }

    switch (e.type) {
      case "line":
        pushSolid(color, wallQuad(e.a, e.b, z0, h));
        break;
      case "polyline":
        if (mode === "plate" && e.closed) {
          pushSolid(color, prism(e.points, z0, h));
        } else {
          for (const [a, b] of segmentsOf(e, e.closed)) {
            pushSolid(color, wallQuad(a, b, z0, h));
          }
        }
        break;
      case "circle":
        if (mode === "plate") {
          const cyl = new THREE.CylinderGeometry(e.radius, e.radius, h, 48);
          // CylinderGeometry is Y-up and centered; stand it up (Z) and lift.
          cyl.rotateX(Math.PI / 2);
          cyl.translate(e.center.x, e.center.y, z0 + h / 2);
          pushSolid(color, cyl);
        } else {
          const cyl = new THREE.CylinderGeometry(e.radius, e.radius, h, 48, 1, true);
          cyl.rotateX(Math.PI / 2);
          cyl.translate(e.center.x, e.center.y, z0 + h / 2);
          pushSolid(color, cyl);
        }
        break;
      case "arc":
        pushSolid(color, arcWall(e.center, e.radius, e.startAngle, e.endAngle, z0, h));
        break;
    }
  }

  const solids = new Map<string, THREE.BufferGeometry>();
  for (const [color, parts] of solidParts) {
    if (parts.length === 0) continue;
    const merged = mergeGeometries(parts, false);
    if (merged) solids.set(color, merged);
  }
  return { solids, lines };
}
