import type { Vec2 } from "../math/Vec2.ts";
import {
  add,
  distance,
  rotateAround,
  scale as vscale,
  sub,
} from "../math/Vec2.ts";
import {
  angleInArc,
  boundsFromPoints,
  closestPointOnSegment,
  emptyBounds,
  expandBounds,
  normalizeAngle,
  type Bounds,
} from "../math/geometry.ts";

export type EntityType = "line" | "polyline" | "circle" | "arc" | "text";

interface BaseEntity {
  id: string;
  type: EntityType;
  layer: string;
  /** Optional per-entity color override; falls back to layer color when null. */
  color: string | null;
}

export interface LineEntity extends BaseEntity {
  type: "line";
  a: Vec2;
  b: Vec2;
}

export interface PolylineEntity extends BaseEntity {
  type: "polyline";
  points: Vec2[];
  closed: boolean;
}

export interface CircleEntity extends BaseEntity {
  type: "circle";
  center: Vec2;
  radius: number;
}

export interface ArcEntity extends BaseEntity {
  type: "arc";
  center: Vec2;
  radius: number;
  /** Radians, CCW from +X. Arc is drawn CCW from startAngle to endAngle. */
  startAngle: number;
  endAngle: number;
}

export interface TextEntity extends BaseEntity {
  type: "text";
  position: Vec2;
  content: string;
  height: number;
  /** Rotation in radians. */
  rotation: number;
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | TextEntity;

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `e${Date.now().toString(36)}${(idCounter).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export function entityBounds(e: Entity): Bounds {
  switch (e.type) {
    case "line":
      return boundsFromPoints([e.a, e.b]);
    case "polyline":
      return boundsFromPoints(e.points);
    case "circle": {
      return {
        minX: e.center.x - e.radius,
        minY: e.center.y - e.radius,
        maxX: e.center.x + e.radius,
        maxY: e.center.y + e.radius,
      };
    }
    case "arc":
      return arcBounds(e);
    case "text": {
      const w = e.content.length * e.height * 0.6;
      const b = emptyBounds();
      expandBounds(b, e.position.x, e.position.y);
      expandBounds(b, e.position.x + w, e.position.y + e.height);
      return b;
    }
  }
}

function arcBounds(e: ArcEntity): Bounds {
  const b = emptyBounds();
  const s = pointOnCircle(e.center, e.radius, e.startAngle);
  const t = pointOnCircle(e.center, e.radius, e.endAngle);
  expandBounds(b, s.x, s.y);
  expandBounds(b, t.x, t.y);
  // Include cardinal extremes that fall within the sweep.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (angleInArc(a, e.startAngle, e.endAngle)) {
      const p = pointOnCircle(e.center, e.radius, a);
      expandBounds(b, p.x, p.y);
    }
  }
  return b;
}

export function pointOnCircle(center: Vec2, radius: number, ang: number): Vec2 {
  return { x: center.x + radius * Math.cos(ang), y: center.y + radius * Math.sin(ang) };
}

// ---------------------------------------------------------------------------
// Hit testing (world-space distance from a point to the entity)
// ---------------------------------------------------------------------------

/** Returns the smallest distance from p to the entity outline, in world units. */
export function distanceToEntity(e: Entity, p: Vec2): number {
  switch (e.type) {
    case "line":
      return Math.sqrt(closestPointOnSegment(p, e.a, e.b).distSq);
    case "polyline": {
      let best = Infinity;
      const n = e.points.length;
      const last = e.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = e.points[i];
        const b = e.points[(i + 1) % n];
        best = Math.min(best, closestPointOnSegment(p, a, b).distSq);
      }
      return Math.sqrt(best);
    }
    case "circle":
      return Math.abs(distance(p, e.center) - e.radius);
    case "arc": {
      const ang = Math.atan2(p.y - e.center.y, p.x - e.center.x);
      if (angleInArc(ang, e.startAngle, e.endAngle)) {
        return Math.abs(distance(p, e.center) - e.radius);
      }
      const s = pointOnCircle(e.center, e.radius, e.startAngle);
      const t = pointOnCircle(e.center, e.radius, e.endAngle);
      return Math.min(distance(p, s), distance(p, t));
    }
    case "text": {
      const b = entityBounds(e);
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cy = Math.max(b.minY, Math.min(p.y, b.maxY));
      return distance(p, { x: cx, y: cy });
    }
  }
}

// ---------------------------------------------------------------------------
// Snap points exposed by an entity (endpoints, midpoints, centers)
// ---------------------------------------------------------------------------

export interface SnapCandidate {
  point: Vec2;
  kind: "end" | "mid" | "center";
}

export function entitySnapPoints(e: Entity): SnapCandidate[] {
  switch (e.type) {
    case "line":
      return [
        { point: e.a, kind: "end" },
        { point: e.b, kind: "end" },
        { point: midOf(e.a, e.b), kind: "mid" },
      ];
    case "polyline": {
      const out: SnapCandidate[] = [];
      const n = e.points.length;
      const last = e.closed ? n : n - 1;
      for (let i = 0; i < n; i++) out.push({ point: e.points[i], kind: "end" });
      for (let i = 0; i < last; i++) {
        out.push({ point: midOf(e.points[i], e.points[(i + 1) % n]), kind: "mid" });
      }
      return out;
    }
    case "circle":
      return [
        { point: e.center, kind: "center" },
        { point: pointOnCircle(e.center, e.radius, 0), kind: "end" },
        { point: pointOnCircle(e.center, e.radius, Math.PI / 2), kind: "end" },
        { point: pointOnCircle(e.center, e.radius, Math.PI), kind: "end" },
        { point: pointOnCircle(e.center, e.radius, -Math.PI / 2), kind: "end" },
      ];
    case "arc":
      return [
        { point: e.center, kind: "center" },
        { point: pointOnCircle(e.center, e.radius, e.startAngle), kind: "end" },
        { point: pointOnCircle(e.center, e.radius, e.endAngle), kind: "end" },
        {
          point: pointOnCircle(
            e.center,
            e.radius,
            midAngle(e.startAngle, e.endAngle),
          ),
          kind: "mid",
        },
      ];
    case "text":
      return [{ point: e.position, kind: "end" }];
  }
}

function midOf(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function midAngle(s: number, e: number): number {
  let ee = normalizeAngle(e);
  const ss = normalizeAngle(s);
  if (ee < ss) ee += Math.PI * 2;
  return (ss + ee) / 2;
}

/** Line segments an entity contributes for intersection snapping. */
export function entitySegments(e: Entity): Array<[Vec2, Vec2]> {
  switch (e.type) {
    case "line":
      return [[e.a, e.b]];
    case "polyline": {
      const segs: Array<[Vec2, Vec2]> = [];
      const n = e.points.length;
      const last = e.closed ? n : n - 1;
      for (let i = 0; i < last; i++) segs.push([e.points[i], e.points[(i + 1) % n]]);
      return segs;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Transforms (return new entities; the model is treated as immutable-ish)
// ---------------------------------------------------------------------------

export function translateEntity(e: Entity, d: Vec2): Entity {
  switch (e.type) {
    case "line":
      return { ...e, a: add(e.a, d), b: add(e.b, d) };
    case "polyline":
      return { ...e, points: e.points.map((p) => add(p, d)) };
    case "circle":
      return { ...e, center: add(e.center, d) };
    case "arc":
      return { ...e, center: add(e.center, d) };
    case "text":
      return { ...e, position: add(e.position, d) };
  }
}

export function rotateEntity(e: Entity, center: Vec2, radians: number): Entity {
  const r = (p: Vec2) => rotateAround(p, center, radians);
  switch (e.type) {
    case "line":
      return { ...e, a: r(e.a), b: r(e.b) };
    case "polyline":
      return { ...e, points: e.points.map(r) };
    case "circle":
      return { ...e, center: r(e.center) };
    case "arc":
      return {
        ...e,
        center: r(e.center),
        startAngle: e.startAngle + radians,
        endAngle: e.endAngle + radians,
      };
    case "text":
      return { ...e, position: r(e.position), rotation: e.rotation + radians };
  }
}

export function scaleEntity(e: Entity, center: Vec2, factor: number): Entity {
  const s = (p: Vec2) => add(center, vscale(sub(p, center), factor));
  switch (e.type) {
    case "line":
      return { ...e, a: s(e.a), b: s(e.b) };
    case "polyline":
      return { ...e, points: e.points.map(s) };
    case "circle":
      return { ...e, center: s(e.center), radius: e.radius * factor };
    case "arc":
      return { ...e, center: s(e.center), radius: e.radius * factor };
    case "text":
      return { ...e, position: s(e.position), height: e.height * factor };
  }
}

/** A single representative anchor point for an entity (used by move/copy grips). */
export function entityAnchor(e: Entity): Vec2 {
  switch (e.type) {
    case "line":
      return e.a;
    case "polyline":
      return e.points[0] ?? { x: 0, y: 0 };
    case "circle":
    case "arc":
      return e.center;
    case "text":
      return e.position;
  }
}
