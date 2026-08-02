/**
 * Tests du pull composition dans pfs-verify-apply.ts
 *
 * Objectif : garantir que `resolvePfsCompositionsToLocal` produit bien un
 * array `{ compositionId, percentage }[]` pour la table ProductComposition à
 * partir du format PFS (checkRef.material_composition), avec :
 *   - résolution des codes PFS connus (Composition existante mappée)
 *   - BLOCAGE + erreur claire si un code PFS n'a pas de mapping local
 *     (règle post-incident 2026-08-01 : jamais d'auto-création silencieuse)
 *   - dédoublonnage + merge des pourcentages si 2 codes PFS mappent vers la
 *     même Composition locale (alias par nom)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted requis : Vitest lève les vi.mock() en haut du fichier, ce qui les
// exécute AVANT toute déclaration classique. Sans hoisted, `prismaMock` est
// undefined au moment où pfs-verify-apply.ts est parsé (car il importe
// prisma en top-level).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    composition: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/pfs-import", () => ({ createOrLinkMapping: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Les mocks ci-dessous ne sont pas exercés par resolvePfsCompositionsToLocal
// mais sont nécessaires pour que l'import du module ne casse pas.
vi.mock("@/lib/pfs-api", () => ({
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateProduct: vi.fn(),
  pfsPatchVariants: vi.fn(),
  pfsSetVariantsAvailability: vi.fn(),
  pfsUpdateStatus: vi.fn(),
}));
vi.mock("@/lib/pfs-status", () => ({ mapLocalToPfsStatus: vi.fn() }));
vi.mock("@/lib/pfs-out-of-stock-config", () => ({ getPfsOutOfStockConfig: vi.fn() }));
vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn(),
  loadMarketplaceMarkupConfigs: vi.fn(),
}));
vi.mock("@/lib/pfs-verify-variant-ops", () => ({
  pushAddPfsVariantFromLocal: vi.fn(),
  pushRemovePfsVariant: vi.fn(),
  pullAddLocalVariantFromPfs: vi.fn(),
  pullRemoveLocalVariant: vi.fn(),
}));
vi.mock("@/lib/pfs-admin-api", () => ({
  pfsAdminFetchMaterialComposition: vi.fn(),
}));

import { resolvePfsCompositionsToLocal } from "@/lib/pfs-verify-apply";

type PfsCompo = Parameters<typeof resolvePfsCompositionsToLocal>[0][number];

const compoCoton = (): PfsCompo => ({
  id: "sf-cotton", reference: "COTTON", percentage: 100, labels: { fr: "Coton", en: "Cotton" },
});
const compoAcier = (): PfsCompo => ({
  id: "sf-steel", reference: "ACIERINOXYDABLE", percentage: 100, labels: { fr: "Acier inoxydable" },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePfsCompositionsToLocal", () => {
  it("renvoie [] si le tableau PFS est vide", async () => {
    const result = await resolvePfsCompositionsToLocal([]);
    expect(result).toEqual([]);
    expect(prismaMock.composition.findMany).not.toHaveBeenCalled();
  });

  it("résout un code PFS connu (Composition existante)", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([
      { id: "loc-cotton", pfsCompositionRef: "COTTON" },
    ]);
    const result = await resolvePfsCompositionsToLocal([compoCoton()]);
    expect(result).toEqual([{ compositionId: "loc-cotton", percentage: 100 }]);
  });

  it("lève une erreur claire quand le code PFS n'a pas de mapping local (jamais d'auto-création)", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([]); // aucun mapping existant
    await expect(resolvePfsCompositionsToLocal([compoAcier()])).rejects.toThrow(
      /« Acier inoxydable »/,
    );
  });

  it("liste toutes les matières manquantes dans le message d'erreur", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([]);
    await expect(
      resolvePfsCompositionsToLocal([
        compoCoton(),
        compoAcier(),
      ]),
    ).rejects.toThrow(/« Coton »[^«]+« Acier inoxydable »/);
  });

  it("gère plusieurs compositions (multi-slots) — reference distincts, garde chacune", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([
      { id: "loc-cotton", pfsCompositionRef: "COTTON" },
      { id: "loc-elast", pfsCompositionRef: "ELASTHANNE" },
    ]);
    const result = await resolvePfsCompositionsToLocal([
      { id: "1", reference: "COTTON", percentage: 95, labels: { fr: "Coton" } },
      { id: "2", reference: "ELASTHANNE", percentage: 5, labels: { fr: "Élasthanne" } },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.compositionId === "loc-cotton")).toEqual({ compositionId: "loc-cotton", percentage: 95 });
    expect(result.find((r) => r.compositionId === "loc-elast")).toEqual({ compositionId: "loc-elast", percentage: 5 });
  });

  it("merge les pourcentages quand 2 codes PFS distincts mappent sur la même Composition locale (alias par nom)", async () => {
    // Ex: PFS renvoie "COTTON" 60% + "COTON_ORGANIQUE" 40% et les deux sont
    // aliasés en local sur la même Composition "Coton".
    prismaMock.composition.findMany.mockResolvedValueOnce([
      { id: "loc-cotton", pfsCompositionRef: "COTTON" },
      { id: "loc-cotton", pfsCompositionRef: "COTON_ORGANIQUE" },
    ]);
    const result = await resolvePfsCompositionsToLocal([
      { id: "1", reference: "COTTON", percentage: 60, labels: { fr: "Coton" } },
      { id: "2", reference: "COTON_ORGANIQUE", percentage: 40, labels: { fr: "Coton bio" } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ compositionId: "loc-cotton", percentage: 100 });
  });

  it("préserve les pourcentages fractionnaires (ex : Argent 925 = 92.5%)", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([
      { id: "loc-silver", pfsCompositionRef: "SILVER" },
    ]);
    const result = await resolvePfsCompositionsToLocal([
      { id: "1", reference: "SILVER", percentage: 92.5, labels: { fr: "Argent 925" } },
    ]);
    expect(result).toEqual([{ compositionId: "loc-silver", percentage: 92.5 }]);
  });

  it("utilise le libellé EN en fallback dans le message d'erreur si le libellé FR est absent", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([]);
    await expect(
      resolvePfsCompositionsToLocal([
        { id: "1", reference: "WOOL", percentage: 100, labels: { en: "Wool" } },
      ]),
    ).rejects.toThrow(/« Wool »/);
  });
});
