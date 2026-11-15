import { describe, expect, it } from "vitest";
import { bucketMeans, sparkGeometry } from "./sparkline";

describe("sparkGeometry", () => {
  it("nulo quebra a linha em trechos; trecho de um ponto só é descartado", () => {
    const g = sparkGeometry([1, 2, null, 3, null, 4, 5], 60, 20);
    expect(g.runs).toHaveLength(2);
    expect(g.line(g.runs[0])).toMatch(/^M0\.0 /);
    expect(g.area(g.runs[0])).toMatch(/Z$/);
  });
  it("série só com zeros não divide por zero", () => {
    const g = sparkGeometry([0, 0], 10, 10);
    expect(g.runs[0].every(([, y]) => Number.isFinite(y))).toBe(true);
  });
});

describe("bucketMeans", () => {
  it("média por balde ignorando nulos", () => {
    expect(bucketMeans([1, 3, null, null, 5, 7], (v) => v, 3)).toEqual([2, null, 6]);
  });
});
