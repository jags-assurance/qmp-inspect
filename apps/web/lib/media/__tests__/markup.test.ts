import { describe, expect, it } from "vitest";
import { arrowHeadPoints, drawShapes, ellipseFromDrag, fitWithin, isMeaningfulShape, markedFileName, strokeWidthFor, type MarkupShape } from "../markup";

describe("fitWithin", () => {
  it("scales the longest side down", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, scale: 0.4 });
  });
  it("never scales up", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600, scale: 1 });
  });
  it("handles degenerate sizes", () => {
    expect(fitWithin(0, 10).width).toBe(0);
  });
});

describe("strokeWidthFor", () => {
  it("has a floor and grows with the photo", () => {
    expect(strokeWidthFor(100, 100)).toBe(3);
    expect(strokeWidthFor(1600, 1200)).toBe(10);
  });
});

describe("arrowHeadPoints", () => {
  it("places both barbs behind the tip for a rightward arrow", () => {
    const [a, b] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(a.x).toBeLessThan(100);
    expect(b.x).toBeLessThan(100);
    expect(a.y).toBeCloseTo(-b.y);
  });
});

describe("ellipseFromDrag", () => {
  it("is symmetric regardless of drag direction", () => {
    expect(ellipseFromDrag({ x: 10, y: 20 }, { x: 50, y: 60 })).toEqual(ellipseFromDrag({ x: 50, y: 60 }, { x: 10, y: 20 }));
    expect(ellipseFromDrag({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ cx: 5, cy: 10, rx: 5, ry: 10 });
  });
});

describe("isMeaningfulShape", () => {
  it("drops dots and zero-length drags", () => {
    expect(isMeaningfulShape({ tool: "pen", color: "#fff", points: [{ x: 1, y: 1 }] })).toBe(false);
    expect(isMeaningfulShape({ tool: "arrow", color: "#fff", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).toBe(false);
    expect(isMeaningfulShape({ tool: "circle", color: "#fff", points: [{ x: 0, y: 0 }, { x: 30, y: 30 }] })).toBe(true);
  });
});

describe("drawShapes", () => {
  it("issues a stroke per shape and ignores single-point shapes", () => {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      stroke: () => calls.push("stroke"),
      ellipse: () => calls.push("ellipse"),
      save: () => undefined,
      restore: () => undefined,
      lineWidth: 0,
      strokeStyle: "",
      lineCap: "butt" as CanvasLineCap,
      lineJoin: "miter" as CanvasLineJoin,
    };
    const shapes: MarkupShape[] = [
      { tool: "pen", color: "#f00", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }] },
      { tool: "circle", color: "#0f0", points: [{ x: 0, y: 0 }, { x: 20, y: 10 }] },
      { tool: "arrow", color: "#00f", points: [{ x: 3, y: 3 }] },
    ];
    drawShapes(ctx, shapes, 4);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(2);
    expect(calls).toContain("ellipse");
  });
});

describe("markedFileName", () => {
  it("swaps the extension", () => {
    expect(markedFileName("IMG_1.HEIC")).toBe("IMG_1-marked.jpg");
    expect(markedFileName("")).toBe("photo-marked.jpg");
  });
});
