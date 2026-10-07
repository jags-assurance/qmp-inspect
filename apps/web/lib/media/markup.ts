// Geometry and drawing helpers for the photo markup (annotate) step. The geometry is pure and
// unit-tested; drawShapes only needs a CanvasRenderingContext2D-shaped object.

export interface Pt {
  x: number;
  y: number;
}

export type MarkupTool = "pen" | "arrow" | "circle";

export interface MarkupShape {
  tool: MarkupTool;
  color: string;
  /** pen: every sampled point; arrow / circle: [start, end]. */
  points: Pt[];
}

export const MARKUP_COLORS = ["#e11d48", "#facc15", "#ffffff", "#111827"] as const;
export const MARKUP_MAX_SIDE = 1600;

/** Scales (w, h) down so the longest side is at most `max`; never scales up. */
export function fitWithin(w: number, h: number, max: number = MARKUP_MAX_SIDE): { width: number; height: number; scale: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** Line width that reads well at any photo size (about 0.6% of the longest side, at least 3 px). */
export function strokeWidthFor(width: number, height: number): number {
  return Math.max(3, Math.round(Math.max(width, height) * 0.006));
}

/** The two barb end points of an arrow head at `to`, pointing away from `from`. */
export function arrowHeadPoints(from: Pt, to: Pt, size: number, spread = Math.PI / 7): [Pt, Pt] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/** Ellipse inscribed in the box between two drag points. */
export function ellipseFromDrag(a: Pt, b: Pt): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
}

/** A shape worth keeping: a dot or zero-length drag is dropped. */
export function isMeaningfulShape(shape: MarkupShape, minDistance = 4): boolean {
  if (shape.points.length < 2) return false;
  const first = shape.points[0];
  const last = shape.points[shape.points.length - 1];
  if (shape.tool === "pen") {
    return shape.points.some((p) => Math.hypot(p.x - first.x, p.y - first.y) >= minDistance);
  }
  return Math.hypot(last.x - first.x, last.y - first.y) >= minDistance;
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "stroke" | "ellipse" | "save" | "restore" | "lineWidth" | "strokeStyle" | "lineCap" | "lineJoin"
>;

export function drawShapes(ctx: Ctx, shapes: MarkupShape[], lineWidth: number): void {
  for (const shape of shapes) {
    if (shape.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const first = shape.points[0];
    const last = shape.points[shape.points.length - 1];
    ctx.beginPath();
    if (shape.tool === "pen") {
      ctx.moveTo(first.x, first.y);
      for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
    } else if (shape.tool === "arrow") {
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      const [l, r] = arrowHeadPoints(first, last, lineWidth * 5);
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(last.x, last.y);
      ctx.lineTo(r.x, r.y);
    } else {
      const e = ellipseFromDrag(first, last);
      ctx.ellipse(e.cx, e.cy, Math.max(1, e.rx), Math.max(1, e.ry), 0, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** File name for the annotated copy: "photo.heic" -> "photo-marked.jpg". */
export function markedFileName(original: string): string {
  const base = original.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}-marked.jpg`;
}
