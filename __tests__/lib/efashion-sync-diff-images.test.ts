import { describe, it, expect } from "vitest";

import {
  diffEfashionSnapshots,
  hasAnyChanges,
  type EfashionSnapshot,
  type EfashionVariantSnapshot,
} from "@/lib/efashion-sync-diff";

function variant(
  efashionProductId: number,
  overrides: Partial<EfashionVariantSnapshot> = {},
): EfashionVariantSnapshot {
  return {
    efashionProductId,
    visible: true,
    prix: 10,
    poids: 0.05,
    stockByTaille: { TU: 5 },
    images: [],
    ...overrides,
  };
}

function snap(variants: EfashionVariantSnapshot[]): EfashionSnapshot {
  return {
    version: 1,
    referenceBase: "F137",
    variants,
    descriptions: { fr: "x", en: "x", it: "x", es: "x", zh: "x" },
    compositions: [],
    primaryEfashionProductId: variants[0]?.efashionProductId ?? null,
  };
}

describe("diffEfashionSnapshots — images", () => {
  it("ne signale rien si la liste d'images est identique", () => {
    const v = variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] });
    const before = snap([v]);
    const after = snap([v]);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.changed).toHaveLength(0);
    expect(hasAnyChanges(diff)).toBe(false);
  });

  it("signale imagesChanged quand on ajoute une photo", () => {
    const beforeV = variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] });
    const afterV = variant(111, {
      images: [
        { dbPath: "/uploads/a.webp", order: 0 },
        { dbPath: "/uploads/b.webp", order: 1 },
      ],
    });
    const diff = diffEfashionSnapshots(snap([beforeV]), snap([afterV]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].imagesChanged).toBe(true);
    expect(hasAnyChanges(diff)).toBe(true);
  });

  it("signale imagesChanged quand on supprime une photo", () => {
    const beforeV = variant(111, {
      images: [
        { dbPath: "/uploads/a.webp", order: 0 },
        { dbPath: "/uploads/b.webp", order: 1 },
      ],
    });
    const afterV = variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] });
    const diff = diffEfashionSnapshots(snap([beforeV]), snap([afterV]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].imagesChanged).toBe(true);
  });

  it("signale imagesChanged quand on réordonne les photos", () => {
    const beforeV = variant(111, {
      images: [
        { dbPath: "/uploads/a.webp", order: 0 },
        { dbPath: "/uploads/b.webp", order: 1 },
      ],
    });
    // On échange a et b (même paths, ordre inversé via les `order`)
    const afterV = variant(111, {
      images: [
        { dbPath: "/uploads/b.webp", order: 0 },
        { dbPath: "/uploads/a.webp", order: 1 },
      ],
    });
    const diff = diffEfashionSnapshots(snap([beforeV]), snap([afterV]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].imagesChanged).toBe(true);
  });

  it("traite un snapshot legacy (sans images côté before) comme inchangé pour les images", () => {
    // Cas réel : snapshot écrit avant l'ajout du champ images. On NE veut PAS
    // que toutes les variantes liées déclenchent une resync photo automatique
    // à la prochaine sync — c'est trop coûteux pour rien.
    const beforeV = variant(111);
    delete (beforeV as { images?: unknown }).images;
    const afterV = variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] });
    const diff = diffEfashionSnapshots(snap([beforeV]), snap([afterV]));
    expect(diff.changed).toHaveLength(0);
  });

  it("considère added comme nouvelle variante (pas dans changed)", () => {
    const before = snap([variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] })]);
    const after = snap([
      variant(111, { images: [{ dbPath: "/uploads/a.webp", order: 0 }] }),
      variant(222, { images: [{ dbPath: "/uploads/b.webp", order: 0 }] }),
    ]);
    const diff = diffEfashionSnapshots(before, after);
    expect(diff.changed).toHaveLength(0);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].efashionProductId).toBe(222);
    expect(diff.added[0].images).toEqual([{ dbPath: "/uploads/b.webp", order: 0 }]);
  });

  it("cumule imagesChanged avec d'autres champs modifiés", () => {
    const beforeV = variant(111, { prix: 10, images: [{ dbPath: "/uploads/a.webp", order: 0 }] });
    const afterV = variant(111, { prix: 12, images: [{ dbPath: "/uploads/b.webp", order: 0 }] });
    const diff = diffEfashionSnapshots(snap([beforeV]), snap([afterV]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].imagesChanged).toBe(true);
    expect(diff.changed[0].fieldsChanged).toContain("prix");
  });
});
