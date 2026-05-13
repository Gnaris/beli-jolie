import { describe, it, expect } from "vitest";
import { buildAnkorstoreShapeProperties } from "@/lib/ankorstore-shape";

describe("buildAnkorstoreShapeProperties", () => {
  it("returns undefined when no weight and no dimensions", () => {
    expect(
      buildAnkorstoreShapeProperties(null, { length: null, width: null, height: null }),
    ).toBeUndefined();
    expect(
      buildAnkorstoreShapeProperties(undefined, { length: null, width: null, height: null }),
    ).toBeUndefined();
  });

  it("emits weight without unit_code (kg is the platform default)", () => {
    const block = buildAnkorstoreShapeProperties(0.05, {
      length: null,
      width: null,
      height: null,
    });
    expect(block).toEqual({ weight: { amount: 0.05 } });
    // Le payload final passé à Ankorstore ne doit pas avoir unit_code sur weight.
    expect((block?.weight as Record<string, unknown> | undefined)?.unitCode).toBeUndefined();
  });

  it("emits dimensions with unit_code=cm when at least one axis is set", () => {
    const block = buildAnkorstoreShapeProperties(null, {
      length: 15,
      width: 8,
      height: 3,
    });
    expect(block).toEqual({
      dimensions: { unitCode: "cm", length: 15, width: 8, height: 3 },
    });
  });

  it("only includes the axes that are actually filled in", () => {
    const block = buildAnkorstoreShapeProperties(null, {
      length: 15,
      width: null,
      height: 3,
    });
    expect(block?.dimensions).toEqual({ unitCode: "cm", length: 15, height: 3 });
    expect((block?.dimensions as Record<string, unknown> | undefined)?.width).toBeUndefined();
  });

  it("combines weight and dimensions when both are present", () => {
    const block = buildAnkorstoreShapeProperties(0.12, {
      length: 20,
      width: 10,
      height: 5,
    });
    expect(block).toEqual({
      weight: { amount: 0.12 },
      dimensions: { unitCode: "cm", length: 20, width: 10, height: 5 },
    });
  });

  it("ignores non-positive or non-finite values", () => {
    const block = buildAnkorstoreShapeProperties(0, {
      length: -5,
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
    });
    expect(block).toBeUndefined();
  });

  it("treats a weight of exactly 0 as 'no weight'", () => {
    const block = buildAnkorstoreShapeProperties(0, {
      length: 10,
      width: null,
      height: null,
    });
    expect(block?.weight).toBeUndefined();
    expect(block?.dimensions).toEqual({ unitCode: "cm", length: 10 });
  });
});
