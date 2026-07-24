import { describe, it, expect } from "vitest";
import {
  buildLabelToRefMap,
  resolveNewRef,
} from "@/scripts/backfill-composition-refs";
import type { PfsAttributeComposition } from "@/lib/pfs-api-write";

/**
 * Bug racine du chantier composition (voir CLAUDE.md commit 2026-07-24) :
 * localement, `Composition.pfsCompositionRef` valait « Coton » alors que la
 * vraie référence PFS est « COTTON ». Le backfill doit remapper toutes ces
 * valeurs, insensible à la casse et aux accents, en s'appuyant sur les
 * labels FR renvoyés par pfsGetCompositions().
 */

const PFS_LIST: PfsAttributeComposition[] = [
  { id: "a0z00...WAAQ", reference: "COTTON", labels: { fr: "Coton", en: "Cotton" } },
  { id: "a0z00...bAAA", reference: "ELASTHANNE", labels: { fr: "Élasthanne", en: "Elastane" } },
  {
    id: "a0z00...ACIER",
    reference: "STAINLESS_STEEL",
    labels: { fr: "Acier inoxydable", en: "Stainless steel" },
  },
  { id: "a0z00...LAITON", reference: "BRASS", labels: { fr: "Laiton", en: "Brass" } },
];

describe("backfill-composition-refs — buildLabelToRefMap", () => {
  it("indexe chaque composition par libellé FR normalisé", () => {
    const m = buildLabelToRefMap(PFS_LIST);
    expect(m.get("coton")).toBe("COTTON");
    expect(m.get("elasthanne")).toBe("ELASTHANNE");
    expect(m.get("acier inoxydable")).toBe("STAINLESS_STEEL");
  });

  it("indexe aussi par référence elle-même (fallback)", () => {
    const m = buildLabelToRefMap(PFS_LIST);
    expect(m.get("cotton")).toBe("COTTON");
    expect(m.get("stainless_steel")).toBe("STAINLESS_STEEL");
  });

  it("indexe aussi par les labels non-FR sans écraser un match FR", () => {
    const m = buildLabelToRefMap(PFS_LIST);
    // « brass » (EN) n'entre pas en conflit avec « laiton » (FR)
    expect(m.get("brass")).toBe("BRASS");
    expect(m.get("laiton")).toBe("BRASS");
  });
});

describe("backfill-composition-refs — resolveNewRef", () => {
  const labelToRef = buildLabelToRefMap(PFS_LIST);

  it("remplace un pfsCompositionRef FR par la vraie ref PFS", () => {
    const res = resolveNewRef(
      { name: "coton", pfsCompositionRef: "Coton" },
      labelToRef,
    );
    expect(res.newRef).toBe("COTTON");
    expect(res.reason).toContain("Coton");
  });

  it("ne fait rien si la ref locale est déjà correcte", () => {
    const res = resolveNewRef(
      { name: "coton", pfsCompositionRef: "COTTON" },
      labelToRef,
    );
    expect(res.newRef).toBeNull();
    expect(res.reason).toBe("déjà à jour");
  });

  it("gère les accents et casses de « Élasthanne »", () => {
    const res = resolveNewRef(
      { name: "Élasthanne", pfsCompositionRef: "Élasthanne" },
      labelToRef,
    );
    expect(res.newRef).toBe("ELASTHANNE");
  });

  it("tombe en fallback sur le champ name si la ref actuelle ne matche pas", () => {
    const res = resolveNewRef(
      { name: "Acier inoxydable", pfsCompositionRef: "vieille-valeur-inconnue" },
      labelToRef,
    );
    expect(res.newRef).toBe("STAINLESS_STEEL");
    expect(res.reason).toContain("Acier inoxydable");
  });

  it("retourne null quand rien ne matche (à corriger manuellement)", () => {
    const res = resolveNewRef(
      { name: "MatériauInventé", pfsCompositionRef: null },
      labelToRef,
    );
    expect(res.newRef).toBeNull();
    expect(res.reason).toContain("aucun match");
  });
});
