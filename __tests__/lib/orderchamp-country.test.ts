import { describe, it, expect } from "vitest";
import {
  normalizeOrderchampCountry,
  resolveOrderchampCountry,
} from "@/lib/orderchamp-country";

describe("orderchamp-country", () => {
  it("normalise en majuscules et trim", () => {
    expect(normalizeOrderchampCountry(" fr ")).toBe("FR");
    expect(normalizeOrderchampCountry("cn")).toBe("CN");
  });

  it("retourne null pour format invalide", () => {
    expect(normalizeOrderchampCountry(null)).toBeNull();
    expect(normalizeOrderchampCountry("")).toBeNull();
    expect(normalizeOrderchampCountry("FRA")).toBeNull(); // alpha-3 refusé
    expect(normalizeOrderchampCountry("F")).toBeNull();
    expect(normalizeOrderchampCountry("F1")).toBeNull();
  });

  it("resolveOrderchampCountry accepte les alpha-2 valides", () => {
    expect(resolveOrderchampCountry("FR")).toBe("FR");
    expect(resolveOrderchampCountry("cn")).toBe("CN");
  });

  it("resolveOrderchampCountry retombe sur CN par défaut", () => {
    expect(resolveOrderchampCountry(null)).toBe("CN");
    expect(resolveOrderchampCountry("")).toBe("CN");
    expect(resolveOrderchampCountry("XYZ")).toBe("CN");
  });

  it("resolveOrderchampCountry accepte un fallback custom", () => {
    expect(resolveOrderchampCountry(null, "FR")).toBe("FR");
  });
});
