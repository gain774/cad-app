import type { CadDocument } from "../core/model/Document.ts";
import { entitySegments, entitySnapPoints } from "../core/model/entities.ts";
import type { Bounds } from "../core/math/geometry.ts";
import { segmentIntersection } from "../core/math/geometry.ts";
import { distance, type Vec2 } from "../core/math/Vec2.ts";
import type { Viewport } from "../render/Viewport.ts";

export type SnapKind = "end" | "mid" | "center" | "intersect" | "grid";

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
}

export interface SnapSettings {
  grid: boolean;
  end: boolean;
  mid: boolean;
  center: boolean;
  intersect: boolean;
  gridSize: number;
}

/**
 * Resolves the best snap point near the cursor. Object snaps (endpoint,
 * midpoint, center, intersection) take priority over grid snap; among object
 * snaps the nearest within the pixel tolerance wins.
 */
export class SnapEngine {
  constructor(private doc: CadDocument, private vp: Viewport) {}

  /** pixelTolerance controls how close (in screen px) a candidate must be. */
  resolve(world: Vec2, settings: SnapSettings, pixelTolerance = 12): SnapResult | null {
    const worldTol = this.vp.toWorldLength(pixelTolerance);
    const region: Bounds = {
      minX: world.x - worldTol,
      minY: world.y - worldTol,
      maxX: world.x + worldTol,
      maxY: world.y + worldTol,
    };
    const ids = this.doc.queryIds(region);

    let best: SnapResult | null = null;
    let bestDist = worldTol;

    const consider = (point: Vec2, kind: SnapKind) => {
      const d = distance(world, point);
      if (d < bestDist) {
        bestDist = d;
        best = { point, kind };
      }
    };

    // Object snaps.
    const segments: Array<[Vec2, Vec2]> = [];
    for (const id of ids) {
      const e = this.doc.get(id);
      if (!e || !this.doc.isLayerVisible(e.layer)) continue;
      for (const sp of entitySnapPoints(e)) {
        if (sp.kind === "end" && !settings.end) continue;
        if (sp.kind === "mid" && !settings.mid) continue;
        if (sp.kind === "center" && !settings.center) continue;
        consider(sp.point, sp.kind);
      }
      if (settings.intersect) segments.push(...entitySegments(e));
    }

    // Intersection snaps between nearby segments.
    if (settings.intersect) {
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const p = segmentIntersection(
            segments[i][0],
            segments[i][1],
            segments[j][0],
            segments[j][1],
          );
          if (p) consider(p, "intersect");
        }
      }
    }

    if (best) return best;

    // Grid snap fallback.
    if (settings.grid && settings.gridSize > 0) {
      const gp = {
        x: Math.round(world.x / settings.gridSize) * settings.gridSize,
        y: Math.round(world.y / settings.gridSize) * settings.gridSize,
      };
      if (distance(world, gp) <= worldTol) {
        return { point: gp, kind: "grid" };
      }
    }
    return null;
  }
}
