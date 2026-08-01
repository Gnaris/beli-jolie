/**
 * Tests unitaires du regroupement d'images du widget « Images ».
 *
 * `groupImages` prend la liste plate renvoyée par l'API et regroupe les images
 * qui partagent (reference, colorName) au-delà d'un seuil pour éviter d'inonder
 * le tiroir pendant un import massif. On vérifie ici :
 *
 *   - un lot < seuil reste éclaté en singles ;
 *   - un lot >= seuil devient un groupe unique avec les bons compteurs ;
 *   - les images sans reference (brouillons) restent en singles ;
 *   - l'ordre chronologique global est préservé.
 */

import { describe, it, expect } from "vitest";
import { groupImages, type ImageItem } from "@/components/admin/widgets-rail/ImagesDrawer";

function mkItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: "form",
    status: "DONE",
    reference: "REF1",
    colorName: "Doré",
    colorHex: "#D4AF37",
    colorPatternImage: null,
    position: 1,
    imagePath: "/uploads/produits/ref1/x.webp",
    error: null,
    createdAt: new Date("2026-07-31T12:00:00Z").toISOString(),
    ...overrides,
  };
}

describe("groupImages", () => {
  it("garde en singles les lots plus petits que le seuil (15)", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mkItem({ id: `a${i}`, position: i + 1 }),
    );
    const out = groupImages(items);
    expect(out).toHaveLength(10);
    expect(out.every((d) => d.kind === "single")).toBe(true);
  });

  it("regroupe en un seul bloc quand un même (reference, couleur) atteint le seuil", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      mkItem({
        id: `b${i}`,
        position: i + 1,
        status: i < 12 ? "DONE" : i < 18 ? "PROCESSING" : "FAILED",
      }),
    );
    const out = groupImages(items);
    expect(out).toHaveLength(1);
    const group = out[0];
    if (group.kind !== "group") throw new Error("attendu: kind=group");
    expect(group.reference).toBe("REF1");
    expect(group.colorName).toBe("Doré");
    expect(group.counts.total).toBe(20);
    expect(group.counts.done).toBe(12);
    expect(group.counts.processing).toBe(6);
    expect(group.counts.failed).toBe(2);
  });

  it("garde séparés deux lots de couleurs différentes sur la même référence", () => {
    const doréItems = Array.from({ length: 16 }, (_, i) =>
      mkItem({ id: `d${i}`, colorName: "Doré" }),
    );
    const argentéItems = Array.from({ length: 16 }, (_, i) =>
      mkItem({ id: `a${i}`, colorName: "Argenté", colorHex: "#C0C0C0" }),
    );
    const out = groupImages([...doréItems, ...argentéItems]);
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.kind === "group")).toBe(true);
    const groupColors = out.map((d) => (d.kind === "group" ? d.colorName : null));
    expect(groupColors).toContain("Doré");
    expect(groupColors).toContain("Argenté");
  });

  it("laisse les items sans reference en singles (brouillons)", () => {
    const brouillons = Array.from({ length: 20 }, (_, i) =>
      mkItem({ id: `br${i}`, reference: null, imagePath: null, status: "PROCESSING" }),
    );
    const out = groupImages(brouillons);
    expect(out).toHaveLength(20);
    expect(out.every((d) => d.kind === "single")).toBe(true);
  });

  it("trie du plus récent au plus ancien, groupes et singles confondus", () => {
    const older = mkItem({
      id: "old",
      reference: "REF-OLD",
      createdAt: "2026-07-31T08:00:00Z",
    });
    const newerGroup = Array.from({ length: 16 }, (_, i) =>
      mkItem({
        id: `n${i}`,
        reference: "REF-NEW",
        createdAt: "2026-07-31T14:00:00Z",
      }),
    );
    const out = groupImages([older, ...newerGroup]);
    expect(out).toHaveLength(2);
    const first = out[0];
    if (first.kind !== "group") throw new Error("le groupe le plus récent doit venir en 1er");
    expect(first.reference).toBe("REF-NEW");
    const second = out[1];
    if (second.kind !== "single") throw new Error("le single ancien doit venir en 2nd");
    expect(second.item.reference).toBe("REF-OLD");
  });
});
