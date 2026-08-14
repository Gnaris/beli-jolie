import { describe, it, expect } from "vitest";
import { computeAnkorImageSyncPlan } from "@/lib/ankorstore-bo/image-sync-plan";

/**
 * Fix bug doublons/triplés d'images Ankor (2026-08-14) :
 *
 * Avant → chaque publish/refresh ré-uploadait toutes les images en
 *   `file-upload:<hash>` frais. Ankor accumulait sans dédupliquer.
 * Après → si les paths BJ n'ont pas changé depuis le dernier sync, on
 *   réutilise les URLs Ankor existantes (`keep`), on n'upload plus.
 *   Sinon on remplace proprement (`replace`).
 */

const emptyAnkor = { productImageUrls: [], variantImageUrlsByColorId: {} };

describe("computeAnkorImageSyncPlan", () => {
  it("première publication (pas de snapshot, pas d'état Ankor) → tout est en replace + tout upload", () => {
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/uploads/produits/A/1.webp",
      bjColors: [
        { colorId: "c1", imagePaths: ["/uploads/produits/A/1.webp", "/uploads/produits/A/2.webp"] },
        { colorId: "c2", imagePaths: ["/uploads/produits/A/3.webp"] },
      ],
      snapshot: null,
      ankor: emptyAnkor,
    });
    expect(plan.productImage.action).toBe("replace");
    expect(plan.colors[0].action).toBe("replace");
    expect(plan.colors[1].action).toBe("replace");
    // 3 paths uniques (l'image produit est aussi la première de c1)
    expect(plan.pathsToUpload.sort()).toEqual([
      "/uploads/produits/A/1.webp",
      "/uploads/produits/A/2.webp",
      "/uploads/produits/A/3.webp",
    ]);
  });

  it("images inchangées depuis dernier sync → tout en keep, aucun upload", () => {
    const bjColors = [
      { colorId: "c1", imagePaths: ["/img/1.webp", "/img/2.webp"] },
      { colorId: "c2", imagePaths: ["/img/3.webp"] },
    ];
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/1.webp",
      bjColors,
      snapshot: {
        productImagePath: "/img/1.webp",
        colorImagePaths: {
          c1: ["/img/1.webp", "/img/2.webp"],
          c2: ["/img/3.webp"],
        },
      },
      ankor: {
        productImageUrls: ["/products/images/prod-11.jpg"],
        variantImageUrlsByColorId: {
          c1: ["/products/images/v1-a.jpg", "/products/images/v1-b.jpg"],
          c2: ["/products/images/v2.jpg"],
        },
      },
    });
    expect(plan.productImage).toEqual({
      action: "keep",
      urls: ["/products/images/prod-11.jpg"],
    });
    expect(plan.colors[0]).toEqual({
      colorId: "c1",
      action: "keep",
      urls: ["/products/images/v1-a.jpg", "/products/images/v1-b.jpg"],
    });
    expect(plan.colors[1]).toEqual({
      colorId: "c2",
      action: "keep",
      urls: ["/products/images/v2.jpg"],
    });
    expect(plan.pathsToUpload).toEqual([]);
  });

  it("une seule couleur touchée (image ajoutée) → cette couleur en replace, les autres en keep", () => {
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/1.webp",
      bjColors: [
        { colorId: "c1", imagePaths: ["/img/1.webp", "/img/2.webp", "/img/NEW.webp"] },
        { colorId: "c2", imagePaths: ["/img/3.webp"] },
      ],
      snapshot: {
        productImagePath: "/img/1.webp",
        colorImagePaths: {
          c1: ["/img/1.webp", "/img/2.webp"],
          c2: ["/img/3.webp"],
        },
      },
      ankor: {
        productImageUrls: ["/products/images/prod.jpg"],
        variantImageUrlsByColorId: {
          c1: ["/products/images/v1-a.jpg", "/products/images/v1-b.jpg"],
          c2: ["/products/images/v2.jpg"],
        },
      },
    });
    expect(plan.productImage.action).toBe("keep");
    expect(plan.colors[0].action).toBe("replace");
    expect(plan.colors[1].action).toBe("keep");
    // Upload = les 3 paths de la couleur remplacée (Ankor va tout écraser)
    expect(plan.pathsToUpload.sort()).toEqual([
      "/img/1.webp",
      "/img/2.webp",
      "/img/NEW.webp",
    ]);
  });

  it("couleur principale change → image produit-père passe en replace, variantes inchangées restent keep", () => {
    // La cliente a basculé la primary color : maintenant l'image produit-père
    // = première photo de la nouvelle couleur principale. Les images des
    // variantes n'ont pas bougé côté BJ → keep pour toutes.
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/3.webp", // était /img/1.webp avant
      bjColors: [
        { colorId: "c1", imagePaths: ["/img/1.webp", "/img/2.webp"] },
        { colorId: "c2", imagePaths: ["/img/3.webp"] },
      ],
      snapshot: {
        productImagePath: "/img/1.webp",
        colorImagePaths: {
          c1: ["/img/1.webp", "/img/2.webp"],
          c2: ["/img/3.webp"],
        },
      },
      ankor: {
        productImageUrls: ["/products/images/prod-old.jpg"],
        variantImageUrlsByColorId: {
          c1: ["/products/images/v1-a.jpg", "/products/images/v1-b.jpg"],
          c2: ["/products/images/v2.jpg"],
        },
      },
    });
    expect(plan.productImage.action).toBe("replace");
    expect(plan.colors[0].action).toBe("keep");
    expect(plan.colors[1].action).toBe("keep");
    // Seule l'image produit-père est ré-uploadée.
    expect(plan.pathsToUpload).toEqual(["/img/3.webp"]);
  });

  it("ordre des images changé → replace (Ankor ne préserve pas l'ordre autrement)", () => {
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/1.webp",
      bjColors: [
        { colorId: "c1", imagePaths: ["/img/B.webp", "/img/A.webp"] }, // ordre inversé
      ],
      snapshot: {
        productImagePath: "/img/1.webp",
        colorImagePaths: { c1: ["/img/A.webp", "/img/B.webp"] },
      },
      ankor: {
        productImageUrls: ["/products/images/prod.jpg"],
        variantImageUrlsByColorId: { c1: ["/products/images/A.jpg", "/products/images/B.jpg"] },
      },
    });
    expect(plan.colors[0].action).toBe("replace");
  });

  it("Ankor a moins d'images que le snapshot (bug antérieur, dépublication partielle) → replace pour recaler", () => {
    // Cas défensif : si Ankor a perdu une image de son côté (ex: variante
    // recréée), le count diverge → on force un replace pour recaler l'état.
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/1.webp",
      bjColors: [{ colorId: "c1", imagePaths: ["/img/1.webp", "/img/2.webp"] }],
      snapshot: {
        productImagePath: "/img/1.webp",
        colorImagePaths: { c1: ["/img/1.webp", "/img/2.webp"] },
      },
      ankor: {
        productImageUrls: ["/products/images/prod.jpg"],
        variantImageUrlsByColorId: { c1: ["/products/images/v1.jpg"] }, // 1 au lieu de 2
      },
    });
    expect(plan.colors[0].action).toBe("replace");
  });

  it("variante sans images → action 'none' (n'apparaît pas dans les uploads)", () => {
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: null,
      bjColors: [{ colorId: "c1", imagePaths: [] }],
      snapshot: null,
      ankor: emptyAnkor,
    });
    expect(plan.productImage.action).toBe("none");
    expect(plan.colors[0].action).toBe("none");
    expect(plan.pathsToUpload).toEqual([]);
  });

  it("nextSnapshot reflète les paths BJ envoyés (pour le prochain diff)", () => {
    const plan = computeAnkorImageSyncPlan({
      bjProductImagePath: "/img/1.webp",
      bjColors: [
        { colorId: "c1", imagePaths: ["/img/1.webp", "/img/2.webp"] },
        { colorId: "c2", imagePaths: ["/img/3.webp"] },
      ],
      snapshot: null,
      ankor: emptyAnkor,
    });
    expect(plan.nextSnapshot).toEqual({
      productImagePath: "/img/1.webp",
      colorImagePaths: {
        c1: ["/img/1.webp", "/img/2.webp"],
        c2: ["/img/3.webp"],
      },
    });
  });
});
