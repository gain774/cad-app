import type { Vec2 } from "../core/math/Vec2.ts";
import { DEG } from "../core/math/geometry.ts";

export type ParsedInput =
  | { kind: "point"; point: Vec2 }
  | { kind: "relative"; delta: Vec2 }
  | { kind: "polar"; distance: number; angle: number }
  | { kind: "command"; text: string }
  | { kind: "empty" }
  | { kind: "invalid" };

/**
 * Parse a command-line entry the way AutoCAD/JWW users expect:
 *   "100,50"      -> absolute point
 *   "@50,0"       -> relative offset from the last point
 *   "@100<45"     -> relative polar (distance < angle in degrees)
 *   "L" / "LINE"  -> a command keyword
 *   ""            -> empty (Enter)
 */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };

  // Polar: @dist<angle  (also accept dist<angle without @)
  const polar = text.match(/^@?\s*(-?\d*\.?\d+)\s*<\s*(-?\d*\.?\d+)$/);
  if (polar) {
    return {
      kind: "polar",
      distance: parseFloat(polar[1]),
      angle: parseFloat(polar[2]) * DEG,
    };
  }

  // Relative: @dx,dy
  const rel = text.match(/^@\s*(-?\d*\.?\d+)\s*[,\s]\s*(-?\d*\.?\d+)$/);
  if (rel) {
    return { kind: "relative", delta: { x: parseFloat(rel[1]), y: parseFloat(rel[2]) } };
  }

  // Absolute: x,y
  const abs = text.match(/^(-?\d*\.?\d+)\s*[,\s]\s*(-?\d*\.?\d+)$/);
  if (abs) {
    return { kind: "point", point: { x: parseFloat(abs[1]), y: parseFloat(abs[2]) } };
  }

  // Otherwise a command keyword or free text.
  return { kind: "command", text };
}

/** Resolve a parsed coordinate into an absolute world point given a reference. */
export function resolvePoint(parsed: ParsedInput, reference: Vec2 | null): Vec2 | null {
  switch (parsed.kind) {
    case "point":
      return parsed.point;
    case "relative":
      return reference ? { x: reference.x + parsed.delta.x, y: reference.y + parsed.delta.y } : null;
    case "polar": {
      if (!reference) return null;
      return {
        x: reference.x + parsed.distance * Math.cos(parsed.angle),
        y: reference.y + parsed.distance * Math.sin(parsed.angle),
      };
    }
    default:
      return null;
  }
}
