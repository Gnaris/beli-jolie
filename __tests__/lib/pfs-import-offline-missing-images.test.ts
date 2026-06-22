import { describe, it, expect } from "vitest";
import { applyMissingImageDowngrade } from "@/lib/pfs-import";

describe("applyMissingImageDowngrade", () => {
  it("laisse ONLINE quand toutes les couleurs ont au moins une image", () => {
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["argent", "dore"],
      ["argent", "dore", "argent"],
    );
    expect(result.status).toBe("ONLINE");
    expect(result.missingColorIds).toEqual([]);
  });

  it("garde ONLINE quand au moins une couleur a une image (les autres seront masquées côté visiteur)", () => {
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["argent", "dore"],
      ["argent"],
    );
    expect(result.status).toBe("ONLINE");
    expect(result.missingColorIds).toEqual(["dore"]);
  });

  it("force OFFLINE quand aucune image n'a été téléchargée", () => {
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["argent", "dore"],
      [],
    );
    expect(result.status).toBe("OFFLINE");
    expect(result.missingColorIds.sort()).toEqual(["argent", "dore"]);
  });

  it("ne touche pas à OFFLINE et signale toujours les couleurs manquantes (statut PFS = OFFLINE)", () => {
    // Le produit est déjà hors ligne côté PFS (DRAFT, ARCHIVED…), on conserve.
    const result = applyMissingImageDowngrade(
      "OFFLINE",
      ["argent", "dore"],
      ["argent"],
    );
    expect(result.status).toBe("OFFLINE");
    expect(result.missingColorIds).toEqual(["dore"]);
  });

  it("considère UNIT et PACK de la même couleur comme couverts par la même image", () => {
    // Deux variantes plannifiées partagent le colorId "argent" : une seule
    // image suffit. C'est aligné avec findMissingImageCoverage et la
    // validation du formulaire admin.
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["argent", "argent"],
      ["argent"],
    );
    expect(result.status).toBe("ONLINE");
    expect(result.missingColorIds).toEqual([]);
  });

  it("dédoublonne les colorIds manquants quand plusieurs variantes partagent la même couleur sans image", () => {
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["dore", "dore"],
      [],
    );
    expect(result.status).toBe("OFFLINE");
    expect(result.missingColorIds).toEqual(["dore"]);
  });

  it("garde ONLINE pour un produit à 3 couleurs dont une seule a une image", () => {
    const result = applyMissingImageDowngrade(
      "ONLINE",
      ["argent", "dore", "rose"],
      ["argent"],
    );
    expect(result.status).toBe("ONLINE");
    expect(result.missingColorIds.sort()).toEqual(["dore", "rose"]);
  });
});
