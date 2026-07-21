import type { Vec2 } from "./Vec2.ts";

/**
 * 2D affine transform stored as a flat 6-element array [a, b, c, d, e, f]
 * mapping a point (x, y) to (a*x + c*y + e, b*x + d*y + f).
 * Same convention as CanvasRenderingContext2D.setTransform.
 */
export type Mat3 = [number, number, number, number, number, number];

export function identity(): Mat3 {
  return [1, 0, 0, 1, 0, 0];
}

export function translate(tx: number, ty: number): Mat3 {
  return [1, 0, 0, 1, tx, ty];
}

export function scaling(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, sy, 0, 0];
}

/** m2 applied after m1 (i.e. result = m2 * m1). */
export function multiply(m2: Mat3, m1: Mat3): Mat3 {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

export function apply(m: Mat3, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return identity();
  const id = 1 / det;
  return [
    d * id,
    -b * id,
    -c * id,
    a * id,
    (c * f - d * e) * id,
    (b * e - a * f) * id,
  ];
}
