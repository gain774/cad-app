import type { Vec2 } from "./Vec2.ts";
import { add, distanceSq, dot, scale, sub } from "./Vec2.ts";

/** Axis-aligned bounding box in world coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBounds(): Bounds {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

export function boundsFromPoints(pts: Vec2[]): Bounds {
  const b = emptyBounds();
  for (const p of pts) expandBounds(b, p.x, p.y);
  return b;
}

export function expandBounds(b: Bounds, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsValid(b: Bounds): boolean {
  return b.minX <= b.maxX && b.minY <= b.maxY;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boundsContainsPoint(b: Bounds, p: Vec2, pad = 0): boolean {
  return (
    p.x >= b.minX - pad &&
    p.x <= b.maxX + pad &&
    p.y >= b.minY - pad &&
    p.y <= b.maxY + pad
  );
}

/** Closest point on segment [a,b] to p, and squared distance. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; distSq: number; t: number } {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  let t = lenSq > 1e-12 ? dot(sub(p, a), ab) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return { point, distSq: distanceSq(p, point), t };
}

/** Intersection point of two segments, or null. Used for snapping & analysis. */
export function segmentIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** Is angle within the CCW sweep from start to end? */
export function angleInArc(angle: number, start: number, end: number): boolean {
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  let e = normalizeAngle(end);
  if (e < s) e += Math.PI * 2;
  let aa = a;
  if (aa < s) aa += Math.PI * 2;
  return aa >= s && aa <= e;
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
