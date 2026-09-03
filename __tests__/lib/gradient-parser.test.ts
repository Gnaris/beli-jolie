import { describe, it, expect } from "vitest";
import {
  parseGradient,
  serializeGradient,
  isGradientString,
  DEFAULT_GRADIENT,
} from "@/lib/gradient-parser";

describe("gradient-parser — détection", () => {
  it("isGradientString reconnaît les 3 types", () => {
    expect(isGradientString("linear-gradient(90deg, #fff, #000)")).toBe(true);
    expect(isGradientString("radial-gradient(#fff, #000)")).toBe(true);
    expect(isGradientString("conic-gradient(from 45deg, red, blue)")).toBe(true);
  });

  it("isGradientString rejette les couleurs simples et null", () => {
    expect(isGradientString("#ff0000")).toBe(false);
    expect(isGradientString("")).toBe(false);
    expect(isGradientString(null)).toBe(false);
    expect(isGradientString(undefined)).toBe(false);
  });
});

describe("gradient-parser — parseGradient", () => {
  it("parse un linear-gradient avec angle et 2 stops explicites", () => {
    const g = parseGradient("linear-gradient(135deg, #0f172a 0%, #334155 100%)");
    expect(g.type).toBe("linear");
    expect(g.angle).toBe(135);
    expect(g.stops).toEqual([
      { color: "#0f172a", position: 0 },
      { color: "#334155", position: 100 },
    ]);
  });

  it("parse un linear-gradient sans positions (auto-distribuées)", () => {
    const g = parseGradient("linear-gradient(90deg, #ff0000, #00ff00, #0000ff)");
    expect(g.type).toBe("linear");
    expect(g.angle).toBe(90);
    expect(g.stops).toHaveLength(3);
    expect(g.stops[0]).toEqual({ color: "#ff0000", position: 0 });
    expect(g.stops[1]).toEqual({ color: "#00ff00", position: 50 });
    expect(g.stops[2]).toEqual({ color: "#0000ff", position: 100 });
  });

  it("parse un linear-gradient avec direction textuelle (to right = 90deg)", () => {
    const g = parseGradient("linear-gradient(to right, #ff0000, #0000ff)");
    expect(g.angle).toBe(90);
  });

  it("parse un radial-gradient (pas d'angle)", () => {
    const g = parseGradient("radial-gradient(#ff0000 0%, #0000ff 100%)");
    expect(g.type).toBe("radial");
    expect(g.stops).toHaveLength(2);
  });

  it("parse un conic-gradient avec from Xdeg", () => {
    const g = parseGradient("conic-gradient(from 45deg, red, blue)");
    expect(g.type).toBe("conic");
    expect(g.angle).toBe(45);
    // "red" et "blue" sont des noms — normalisés à #000000 (fallback)
    expect(g.stops).toHaveLength(2);
  });

  it("retourne le défaut sur une chaîne invalide", () => {
    expect(parseGradient("not a gradient")).toEqual(DEFAULT_GRADIENT);
    expect(parseGradient("")).toEqual(DEFAULT_GRADIENT);
    expect(parseGradient("#ff0000")).toEqual(DEFAULT_GRADIENT);
  });

  it("retourne le défaut si moins de 2 stops", () => {
    const g = parseGradient("linear-gradient(90deg, #ff0000)");
    expect(g).toEqual(DEFAULT_GRADIENT);
  });
});

describe("gradient-parser — serializeGradient", () => {
  it("sérialise un linear-gradient", () => {
    expect(
      serializeGradient({
        type: "linear",
        angle: 135,
        stops: [
          { color: "#0f172a", position: 0 },
          { color: "#334155", position: 100 },
        ],
      }),
    ).toBe("linear-gradient(135deg, #0f172a 0%, #334155 100%)");
  });

  it("sérialise un radial-gradient sans angle", () => {
    expect(
      serializeGradient({
        type: "radial",
        angle: 0,
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ],
      }),
    ).toBe("radial-gradient(#ff0000 0%, #0000ff 100%)");
  });

  it("sérialise un conic avec from Xdeg", () => {
    expect(
      serializeGradient({
        type: "conic",
        angle: 45,
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 100 },
        ],
      }),
    ).toBe("conic-gradient(from 45deg, #ff0000 0%, #0000ff 100%)");
  });

  it("re-trie les stops par position croissante", () => {
    const s = serializeGradient({
      type: "linear",
      angle: 0,
      stops: [
        { color: "#0000ff", position: 100 },
        { color: "#ff0000", position: 0 },
        { color: "#00ff00", position: 50 },
      ],
    });
    expect(s).toBe("linear-gradient(0deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)");
  });
});

describe("gradient-parser — round-trip (parse → serialize)", () => {
  it("préserve un linear avec 3 stops", () => {
    const input = "linear-gradient(180deg, #ff0000 0%, #00ff00 30%, #0000ff 100%)";
    const round = serializeGradient(parseGradient(input));
    expect(round).toBe(input);
  });

  it("préserve un radial avec 2 stops explicites", () => {
    const input = "radial-gradient(#000000 0%, #ffffff 100%)";
    const round = serializeGradient(parseGradient(input));
    expect(round).toBe(input);
  });
});
