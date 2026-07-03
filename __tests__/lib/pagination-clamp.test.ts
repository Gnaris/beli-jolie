import { describe, it, expect } from "vitest";

import { clampPerPage, MAX_PER_PAGE, MIN_PER_PAGE } from "@/lib/pagination";

describe("clampPerPage", () => {
  it("retourne null quand la valeur n'est pas un nombre", () => {
    expect(clampPerPage("abc", 20)).toBeNull();
    expect(clampPerPage("", 20)).toBeNull();
  });

  it("plafonne au maximum autorisé", () => {
    expect(clampPerPage("1000", 20)).toBe(MAX_PER_PAGE);
    expect(clampPerPage("501", 20)).toBe(MAX_PER_PAGE);
  });

  it("ramène au minimum quand la valeur est trop basse", () => {
    // 0 est clamp à 1, mais `|| fallback` renvoie fallback (0 est falsy après clamp seulement si min=0).
    // Ici min=1 donc 0 devient 1 (truthy) — le fallback ne s'applique pas.
    expect(clampPerPage("0", 20)).toBe(MIN_PER_PAGE);
    expect(clampPerPage("-5", 20)).toBe(MIN_PER_PAGE);
  });

  it("laisse passer les valeurs dans la fenêtre autorisée", () => {
    expect(clampPerPage("1", 20)).toBe(1);
    expect(clampPerPage("50", 20)).toBe(50);
    expect(clampPerPage("500", 20)).toBe(500);
  });

  it("tronque les décimales via parseInt", () => {
    expect(clampPerPage("42.9", 20)).toBe(42);
  });
});
