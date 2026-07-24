import type { CadDocument } from "../core/model/Document.ts";
import { entityBounds, pointOnCircle, type Entity } from "../core/model/entities.ts";
import { boundsValid, RAD } from "../core/math/geometry.ts";

/**
 * Export the drawing as an SVG. World Y is up, so we flip vertically into the
 * SVG coordinate space and translate by the drawing's bounds.
 */
export function exportSvg(doc: CadDocument): string {
  const b = doc.totalBounds();
  const pad = 10;
  const hasContent = boundsValid(b);
  const minX = hasContent ? b.minX - pad : 0;
  const minY = hasContent ? b.minY - pad : 0;
  const w = hasContent ? b.maxX - b.minX + pad * 2 : 100;
  const h = hasContent ? b.maxY - b.minY + pad * 2 : 100;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}" height="${fmt(h)}" ` +
      `viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="white"/>`);
  // Flip Y and shift origin so world coords map into the viewBox.
  parts.push(`<g transform="translate(${fmt(-minX)} ${fmt(minY + h)}) scale(1 -1)">`);

  for (const e of doc.all()) {
    if (!doc.isLayerVisible(e.layer)) continue;
    parts.push(entityToSvg(e, doc.effectiveColor(e)));
  }

  parts.push(`</g></svg>`);
  return parts.join("\n");
}

function entityToSvg(e: Entity, color: string): string {
  const stroke = `stroke="${color}" stroke-width="0.5" fill="none" vector-effect="non-scaling-stroke"`;
  switch (e.type) {
    case "line":
      return `<line x1="${fmt(e.a.x)}" y1="${fmt(e.a.y)}" x2="${fmt(e.b.x)}" y2="${fmt(e.b.y)}" ${stroke}/>`;
    case "polyline": {
      const pts = e.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");
      const tag = e.closed ? "polygon" : "polyline";
      return `<${tag} points="${pts}" ${stroke}/>`;
    }
    case "circle":
      return `<circle cx="${fmt(e.center.x)}" cy="${fmt(e.center.y)}" r="${fmt(e.radius)}" ${stroke}/>`;
    case "arc": {
      const s = pointOnCircle(e.center, e.radius, e.startAngle);
      const t = pointOnCircle(e.center, e.radius, e.endAngle);
      let sweep = e.endAngle - e.startAngle;
      while (sweep < 0) sweep += Math.PI * 2;
      const large = sweep > Math.PI ? 1 : 0;
      // sweep-flag 1 = CCW in a normal Y-up frame (we flipped via the group).
      return `<path d="M ${fmt(s.x)} ${fmt(s.y)} A ${fmt(e.radius)} ${fmt(e.radius)} 0 ${large} 1 ${fmt(t.x)} ${fmt(t.y)}" ${stroke}/>`;
    }
    case "text": {
      const b = entityBounds(e);
      void b;
      // Counter-flip the text so it is not mirrored by the group's scale(1,-1).
      return (
        `<text x="0" y="0" font-size="${fmt(e.height)}" fill="${color}" ` +
        `transform="translate(${fmt(e.position.x)} ${fmt(e.position.y)}) scale(1 -1) rotate(${fmt(-e.rotation * RAD)})">` +
        `${escapeXml(e.content)}</text>`
      );
    }
  }
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
