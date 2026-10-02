import { describe, it, expect } from "vitest";
import { canonicalColorKey, pickDisplayColorLabel } from "@/lib/color-aliases";

describe("canonicalColorKey", () => {
  it("normalise une couleur simple", () => {
    expect(canonicalColorKey("Doré")).toBe("dore");
    expect(canonicalColorKey("doré")).toBe("dore");
    expect(canonicalColorKey("  DORÉ  ")).toBe("dore");
  });

  it("retire 'Taille unique' et les séparateurs (Ankor / Faire)", () => {
    expect(canonicalColorKey("Taille unique · Doré")).toBe("dore");
    expect(canonicalColorKey("Taille unique - Doré")).toBe("dore");
    expect(canonicalColorKey("Taille unique, Doré")).toBe("dore");
    expect(canonicalColorKey("Taille unique, Argent")).toBe("argent");
    expect(canonicalColorKey("Doré / Taille unique")).toBe("dore");
    expect(canonicalColorKey("TU · Noir")).toBe("noir");
    expect(canonicalColorKey("One Size - Argenté")).toBe("argente");
  });

  it("applique les alias de synonymes", () => {
    expect(canonicalColorKey("Marine")).toBe("bleu marine");
    expect(canonicalColorKey("Bleu marine")).toBe("bleu marine");
    expect(canonicalColorKey("Bleu nuit")).toBe("bleu marine");
    expect(canonicalColorKey("Navy")).toBe("bleu marine");
  });

  it("combine alias + strip taille", () => {
    expect(canonicalColorKey("Taille unique · Marine")).toBe("bleu marine");
    expect(canonicalColorKey("Navy - TU")).toBe("bleu marine");
  });

  it("retourne null pour vide / null / uniquement tokens taille", () => {
    expect(canonicalColorKey(null)).toBeNull();
    expect(canonicalColorKey(undefined)).toBeNull();
    expect(canonicalColorKey("")).toBeNull();
    expect(canonicalColorKey("   ")).toBeNull();
    expect(canonicalColorKey("Taille unique")).toBeNull();
    expect(canonicalColorKey("TU")).toBeNull();
    expect(canonicalColorKey("One Size")).toBeNull();
  });

  it("fusionne les couleurs cross-marketplace sur la même clé", () => {
    // Le scénario qui a motivé le fix.
    const ankor = canonicalColorKey("Taille unique · Doré");
    const pfs = canonicalColorKey("Doré");
    const efashion = canonicalColorKey("DORE");
    expect(ankor).toBe(pfs);
    expect(pfs).toBe(efashion);
  });
});

describe("pickDisplayColorLabel", () => {
  it("préfère un libellé sans séparateur à un libellé composé", () => {
    expect(
      pickDisplayColorLabel(["Taille unique · Doré", "Doré"]),
    ).toBe("Doré");
    expect(
      pickDisplayColorLabel(["Doré", "Taille unique - Doré", "TU / Doré"]),
    ).toBe("Doré");
  });

  it("prend le plus court en cas d'égalité sur les séparateurs", () => {
    expect(pickDisplayColorLabel(["Bleu marine", "Marine"])).toBe("Marine");
    expect(pickDisplayColorLabel(["Rouge bordeaux", "Bordeaux"])).toBe(
      "Bordeaux",
    );
  });

  it("ignore null / vide", () => {
    expect(pickDisplayColorLabel([null, undefined, "", "Doré"])).toBe("Doré");
    expect(pickDisplayColorLabel([null, undefined])).toBeNull();
    expect(pickDisplayColorLabel([])).toBeNull();
  });

  it("fonctionne avec un Set (itérable)", () => {
    const labels = new Set(["Taille unique · Doré", "Doré"]);
    expect(pickDisplayColorLabel(labels)).toBe("Doré");
  });
});
