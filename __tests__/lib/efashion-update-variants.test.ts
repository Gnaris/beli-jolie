import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock complet des dépendances pour isoler la logique d'update.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    productColor: {
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    color: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionUpdateProduit: vi.fn(),
  efashionUpsertProduitStock: vi.fn(),
  efashionSaveProduitDescription: vi.fn(),
  efashionSaveProduitCompositions: vi.fn(),
  efashionTranslateText: vi.fn(),
  efashionToggleMainProduct: vi.fn(),
  efashionDuplicateWithNewColor: vi.fn(),
  efashionPublishBrouillon: vi.fn(),
  efashionSoftDeleteProduits: vi.fn(),
  efashionGetAllUsedColorIdsByMainProduct: vi.fn().mockResolvedValue([]),
  efashionGetProduitCaracteristiqueIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionPutShootingProduct: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionGetProductPhotos: vi.fn().mockResolvedValue({ photos: [] }),
  efashionDeleteProductPhoto: vi.fn(),
  efashionUploadProductPhotos: vi.fn(),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({ type: "percent", value: 0, rounding: "none" }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-api", () => {
  const listProducts = vi.fn();
  return {
    efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017, nomBoutique: "BJ" }),
    efashionListProducts: listProducts,
    // Délègue à listProducts mocké + filtre strict reference_base
    efashionListByReferenceBaseExact: vi.fn(async (opts: { idVendeur: number; referenceBase: string; premelFilter?: string }) => {
      const r = await listProducts({
        idVendeur: opts.idVendeur,
        take: 50,
        skip: 0,
        reference: opts.referenceBase,
        premelFilter: opts.premelFilter ?? "tous",
      });
      const needle = opts.referenceBase.toLowerCase().trim();
      return (r?.items ?? []).filter(
        (it: { reference_base?: string | null }) =>
          (it.reference_base ?? "").toLowerCase().trim() === needle,
      );
    }),
  };
});

import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import {
  efashionUpdateProduit,
  efashionDuplicateWithNewColor,
  efashionPublishBrouillon,
  efashionSoftDeleteProduits,
} from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";
import { efashionUploadProductPhotos } from "@/lib/efashion-photos";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const productUpdateMock = prisma.product.update as unknown as ReturnType<typeof vi.fn>;
const productColorUpdateMock = prisma.productColor.update as unknown as ReturnType<typeof vi.fn>;
const softDeleteMock = efashionSoftDeleteProduits as unknown as ReturnType<typeof vi.fn>;
const duplicateMock = efashionDuplicateWithNewColor as unknown as ReturnType<typeof vi.fn>;
const publishBrouillonMock = efashionPublishBrouillon as unknown as ReturnType<typeof vi.fn>;
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<typeof vi.fn>;
const listProductsMock = efashionListProducts as unknown as ReturnType<typeof vi.fn>;
const uploadPhotosMock = efashionUploadProductPhotos as unknown as ReturnType<typeof vi.fn>;

/**
 * Construit une couleur BJ « linkée » à eFashion. La signature reproduit ce
 * que `prisma.product.findUnique` retourne dans efashionUpdateProductInPlace.
 */
function makeLinkedColor(args: {
  id: string;
  colorId: string;
  efashionProductId: number | null;
  isPrimary?: boolean;
  unitPrice?: number;
  stock?: number;
  colorName?: string;
  efashionColorId?: number | null;
}) {
  return {
    id: args.id,
    colorId: args.colorId,
    efashionProductId: args.efashionProductId,
    unitPrice: args.unitPrice ?? 10,
    weight: 0.05,
    stock: args.stock ?? 5,
    saleType: "UNIT" as const,
    packQuantity: null,
    disabled: false,
    isPrimary: args.isPrimary ?? false,
    variantSizes: [{ quantity: 1, size: { name: "TU" } }],
    color: {
      name: args.colorName ?? "X",
      efashionColorId: args.efashionColorId ?? 1,
    },
  };
}

/**
 * Construit ce que listProducts renvoie pour une variante eFashion donnée.
 * Le code update consomme ces champs pour reconstruire un payload PUT complet.
 */
function makeLiveItem(args: { id_produit: number; id_couleur: number; main: boolean; reference_base: string }) {
  return {
    id_produit: args.id_produit,
    id_couleur: args.id_couleur,
    reference: `${args.reference_base}-${args.id_couleur}`,
    reference_base: args.reference_base,
    id_collection: 3,
    id_categorie: 160102,
    id_provenance: 1,
    id_declinaison: 11096,
    id_pack: null,
    vendu_par: "couleurs",
    id_vendeur_marque: 3228,
    main: args.main,
    couleur: "X",
    nb_photos: 1,
    visible: true,
    poids: 0.05,
    prix: "10",
    supprimer: false,
  };
}

/**
 * Auto-mock de productColorImage.findMany : dérive 1 image par colorId à partir
 * du dernier retour de prisma.product.findUnique. Sans ça, le filtre
 * `filterVariantsByColorIdSet` (cf. lib/efashion-update.ts) exclurait toutes
 * les variantes des tests parce que `productColorImage.findMany` renverrait
 * un tableau vide par défaut. Une seule fixture suffit pour tous les tests
 * de cette suite (chacun configure ses propres `colors`).
 */
function installAutoColorImagesMock() {
  (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const lastCall = findUniqueMock.mock.results.at(-1);
    if (!lastCall) return [];
    const product = await lastCall.value;
    if (!product?.colors) return [];
    const ids = new Set<string>();
    for (const c of product.colors) if (c.colorId) ids.add(c.colorId);
    return [...ids].map((cid, i) => ({ colorId: cid, path: `m-${cid}.jpg`, order: i }));
  });
}

describe("efashionUpdateProductInPlace — variantes ajoutées/supprimées", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    installAutoColorImagesMock();
    productUpdateMock.mockReset();
    productUpdateMock.mockResolvedValue({});
    productColorUpdateMock.mockReset();
    productColorUpdateMock.mockResolvedValue({});
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(true);
    duplicateMock.mockReset();
    publishBrouillonMock.mockReset();
    publishBrouillonMock.mockResolvedValue(true);
    uploadPhotosMock.mockReset();
    uploadPhotosMock.mockResolvedValue(undefined);
    updateProduitMock.mockReset();
    updateProduitMock.mockResolvedValue({ id_produit: "0", reference: "", id_collection: null, id_categorie: null, prix: "0", poids: 0, vendu_par: "couleurs", visible: true, id_pack: null });
    listProductsMock.mockReset();
  });

  it("appelle efashionSoftDeleteProduits avec tous les IDs retirés localement (batch)", async () => {
    // Snapshot précédent : 3 couleurs liées (101, 102, 103).
    // État BDD actuel : seules 101 et 102 restent (103 supprimée localement).
    findUniqueMock.mockResolvedValue({
      id: "p1",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          { efashionProductId: 102, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          { efashionProductId: 103, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        makeLinkedColor({ id: "pc-102", colorId: "color-102", efashionProductId: 102 }),
        // pas de 103 → diff.removed = [103]
      ],
    });
    // eFashion confirme l'existence de 101 et 102 (l'ancien 103 est resté côté eux).
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" }),
        makeLiveItem({ id_produit: 102, id_couleur: 12, main: false, reference_base: "TEST" }),
      ],
    });
    const res = await efashionUpdateProductInPlace("p1");

    expect(softDeleteMock).toHaveBeenCalledTimes(1);
    expect(softDeleteMock.mock.calls[0][0]).toEqual([103]);
    expect(res.colorsDeletedCount).toBe(1);
    expect(res.success).toBe(true);
  });

  it("force la bascule de la couleur principale eFashion AVANT de la supprimer", async () => {
    // Snapshot précédent : 101 (main eFashion) et 102. L'admin supprime 101
    // localement et désigne 102 comme nouvelle primaire BJ.
    findUniqueMock.mockResolvedValue({
      id: "p2",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          { efashionProductId: 102, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-102",
      compositions: [],
      colors: [
        // 102 devient la nouvelle primaire BJ
        makeLinkedColor({ id: "pc-102", colorId: "color-102", efashionProductId: 102, isPrimary: true }),
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" }),
        makeLiveItem({ id_produit: 102, id_couleur: 12, main: false, reference_base: "TEST" }),
      ],
    });
    await efashionUpdateProductInPlace("p2");

    // La 1ʳᵉ bascule (101 démoté + 102 promu) est faite par le bloc « bascule main »
    // standard parce que `bjPrimaryEfId(102) !== currentMainEfId(101)`. Vérifie
    // que ces 2 appels ont bien eu lieu AVANT le delete de 101.
    const updateCalls = updateProduitMock.mock.calls.map(([c]) => c);
    const demoteIdx = updateCalls.findIndex((c) => c.id_produit === 101 && c.main === false);
    const promoteIdx = updateCalls.findIndex((c) => c.id_produit === 102 && c.main === true);
    expect(demoteIdx).toBeGreaterThanOrEqual(0);
    expect(promoteIdx).toBeGreaterThanOrEqual(0);

    // Et le delete batch a bien inclus 101.
    expect(softDeleteMock).toHaveBeenCalledTimes(1);
    expect(softDeleteMock.mock.calls[0][0]).toContain(101);

    // L'invocation d'updateProduit pour démoter doit précéder l'appel de delete
    // dans la chronologie globale — sinon eFashion peut refuser un delete sur
    // la main du groupe.
    const demoteIndex = updateProduitMock.mock.calls.findIndex(
      ([c]) => c.id_produit === 101 && c.main === false,
    );
    const demoteOrder = updateProduitMock.mock.invocationCallOrder[demoteIndex];
    const deleteOrder = softDeleteMock.mock.invocationCallOrder[0];
    expect(demoteOrder).toBeLessThan(deleteOrder);
  });

  it("skip une couleur ajoutée localement mais absente du live eFashion et remonte une erreur explicite", async () => {
    // Snapshot précédent : 1 couleur (101). L'admin a ajouté localement une 2ᵉ
    // couleur (efashionProductId 999 saisi manuellement, mais 999 n'existe pas
    // côté eFashion).
    findUniqueMock.mockResolvedValue({
      id: "p3",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        makeLinkedColor({ id: "pc-999", colorId: "color-999", efashionProductId: 999 }),
      ],
    });
    // Seul 101 existe côté eFashion.
    listProductsMock.mockResolvedValue({
      items: [makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" })],
    });

    const res = await efashionUpdateProductInPlace("p3");

    expect(res.success).toBe(false);
    expect(res.colorsSkippedCount).toBe(1);
    expect(res.error).toMatch(/inconnue.*eFashion/i);
    expect(res.error).toMatch(/Rafra/i);
    // updateProduit ne doit JAMAIS être appelé pour la couleur 999 (sinon eFashion
    // renverrait une erreur de toute façon).
    const callsFor999 = updateProduitMock.mock.calls.filter(([c]) => c.id_produit === 999);
    expect(callsFor999.length).toBe(0);
  });

  it("auto-crée une nouvelle couleur via PUT shooting (dans le shooting du groupe)", async () => {
    // Snapshot précédent : 1 couleur principale (101 = Doré). L'admin ajoute
    // une couleur Bordeaux localement SANS la lier manuellement à eFashion.
    // Le nouveau flow : PUT /shootings/product/{mainId} avec Bordeaux ajouté
    // dans `couleurs[]` — la nouvelle couleur est créée dans le shooting du
    // groupe (contrairement à `duplicateWithNewColor` qui créait un shooting
    // séparé invisible côté acheteurs).
    const putShootingMock = (
      await import("@/lib/efashion-shootings")
    ).efashionPutShootingProduct as unknown as ReturnType<typeof vi.fn>;
    putShootingMock.mockReset();
    putShootingMock.mockResolvedValue({ success: true });

    findUniqueMock.mockResolvedValue({
      id: "p5",
      reference: "A1852DO",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "A1852DO",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "A1852DO",
        variants: [
          { efashionProductId: 101, visible: true, prix: 3.2, poids: 0.007, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({
          id: "pc-101",
          colorId: "color-101",
          efashionProductId: 101,
          isPrimary: true,
          colorName: "Doré",
          efashionColorId: 78,
        }),
        makeLinkedColor({
          id: "pc-bordeaux",
          colorId: "color-bordeaux",
          efashionProductId: null,
          colorName: "Bordeaux",
          efashionColorId: 66,
        }),
      ],
    });
    // 1er listProducts : eFashion ne connaît que 101 (avant PUT).
    // 2e listProducts (après PUT) : 101 + nouvelle Bordeaux (id_produit=3680371,
    // id_couleur=66, main=false) dans le même shooting.
    listProductsMock
      .mockResolvedValueOnce({
        items: [makeLiveItem({ id_produit: 101, id_couleur: 78, main: true, reference_base: "A1852DO" })],
      })
      .mockResolvedValue({
        items: [
          makeLiveItem({ id_produit: 101, id_couleur: 78, main: true, reference_base: "A1852DO" }),
          makeLiveItem({ id_produit: 3680371, id_couleur: 66, main: false, reference_base: "A1852DO" }),
        ],
      });

    const res = await efashionUpdateProductInPlace("p5");

    // 1. PUT shooting appelé sur le main (101) avec Bordeaux ajouté dans couleurs[]
    expect(putShootingMock).toHaveBeenCalledTimes(1);
    const [putIdProduit, putInput] = putShootingMock.mock.calls[0];
    expect(putIdProduit).toBe(101);
    const couleursIds = (putInput as { couleurs: Array<{ id: number }> }).couleurs.map(
      (c) => c.id,
    );
    expect(couleursIds).toContain(78); // existante (Doré)
    expect(couleursIds).toContain(66); // nouvelle (Bordeaux)
    expect((putInput as { couleurPrincipaleId: number }).couleurPrincipaleId).toBe(78);

    // 2. Pas d'appel à duplicateWithNewColor (ancien flow abandonné — créait
    // un shooting séparé).
    expect(duplicateMock).not.toHaveBeenCalled();

    // 3. ProductColor mis à jour en BDD avec le nouvel efashionProductId
    expect(productColorUpdateMock).toHaveBeenCalledWith({
      where: { id: "pc-bordeaux" },
      data: { efashionProductId: 3680371 },
    });

    // 4. Compteur retourné
    expect(res.colorsCreatedCount).toBe(1);
  });

  it("refuse de créer une couleur déjà présente côté eFashion (anti-doublon)", async () => {
    const usedColorIdsMock = (await import("@/lib/efashion-api-write")).efashionGetAllUsedColorIdsByMainProduct as unknown as ReturnType<typeof vi.fn>;
    usedColorIdsMock.mockResolvedValueOnce([66]); // 66 = Bordeaux est déjà utilisé

    findUniqueMock.mockResolvedValue({
      id: "p6",
      reference: "A1852DO",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "A1852DO",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "A1852DO",
        variants: [
          { efashionProductId: 101, visible: true, prix: 3.2, poids: 0.007, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true, colorName: "Doré", efashionColorId: 78 }),
        makeLinkedColor({ id: "pc-bordeaux", colorId: "color-bordeaux", efashionProductId: null, colorName: "Bordeaux", efashionColorId: 66 }),
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [makeLiveItem({ id_produit: 101, id_couleur: 78, main: true, reference_base: "A1852DO" })],
    });

    const res = await efashionUpdateProductInPlace("p6");

    // duplicate NE doit PAS avoir été appelé (anti-doublon)
    expect(duplicateMock).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/d[ée]j[àa] utilis/i);
  });

  it("rattache TOUTES les couleurs au nouveau main après une bascule (fix BOUCLESOREILLES01)", async () => {
    // Reproduit le bug du 30/05/2026 : un produit à 3 couleurs déjà publié
    // côté eFashion, la cliente lie et la primaire BJ diffère de la main
    // eFashion. La bascule main ne touchait que 2 fiches → la 3ᵉ couleur
    // restait pointée vers l'ANCIENNE main et apparaissait comme un produit
    // séparé sur eFashion. On vérifie ici que la boucle finale rééécrit
    // `id_couleur_liee` sur les 3 variantes.
    findUniqueMock.mockResolvedValue({
      id: "p7",
      reference: "BOUCLESOREILLES01",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "BOUCLESOREILLES01",
      efashionLastSyncSnapshot: null, // forceFullSync simulé par snapshot null
      primaryColorId: "color-200", // BJ veut 200 comme principale
      compositions: [],
      colors: [
        makeLinkedColor({
          id: "pc-100",
          colorId: "color-100",
          efashionProductId: 100,
          colorName: "Vert",
          efashionColorId: 1,
        }),
        makeLinkedColor({
          id: "pc-200",
          colorId: "color-200",
          efashionProductId: 200,
          isPrimary: true,
          colorName: "Rose",
          efashionColorId: 10,
        }),
        makeLinkedColor({
          id: "pc-300",
          colorId: "color-300",
          efashionProductId: 300,
          colorName: "Blanc",
          efashionColorId: 16,
        }),
      ],
    });
    // eFashion : 100 (Vert) est l'ancienne main, 200 et 300 sont non-main.
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 100, id_couleur: 1, main: true, reference_base: "BOUCLESOREILLES01" }),
        makeLiveItem({ id_produit: 200, id_couleur: 10, main: false, reference_base: "BOUCLESOREILLES01" }),
        makeLiveItem({ id_produit: 300, id_couleur: 16, main: false, reference_base: "BOUCLESOREILLES01" }),
      ],
    });

    await efashionUpdateProductInPlace("p7", { forceFullSync: true });

    // Récupère tous les appels updateProduit qui transportent visible/prix/poids
    // (= la boucle finale), en excluant les appels de bascule (qui ont `main`
    // défini explicitement à true/false).
    const finalCalls = updateProduitMock.mock.calls
      .map(([c]) => c)
      .filter((c) => typeof c.prix !== "undefined" && typeof c.poids !== "undefined");

    // Les 3 variantes doivent avoir été appelées dans la boucle finale.
    const idsFromFinalCalls = new Set(finalCalls.map((c) => c.id_produit));
    expect(idsFromFinalCalls).toEqual(new Set([100, 200, 300]));

    // Chaque appel final doit porter id_couleur_liee = 200 (le nouveau main),
    // et main = (id_produit === 200). C'est le cœur du fix.
    for (const c of finalCalls) {
      expect(c.id_couleur_liee).toBe(200);
      expect(c.main).toBe(c.id_produit === 200);
    }
  });

  it("ne déclenche pas le filet d'orphelin avec isPostPublishAlignment, même si liveById est partiel", async () => {
    // Cas appelé en fin de efashionPublishProduct : le flag bypass est posé
    // explicitement parce que toutes les variantes viennent d'être créées
    // par saveMelDraft. Si listProducts a un léger lag et ne voit pas encore
    // la couleur fraîchement créée, on NE doit PAS la filtrer comme orpheline.
    findUniqueMock.mockResolvedValue({
      id: "p4",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: null,
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
      ],
    });
    // Mock du lookup local color → efashionColorId pour que le push stock
    // trouve son id_couleur (sinon l'erreur cosmétique « sans efashionColorId »
    // se déclenche et pollue le test).
    (prisma.color.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "color-101", efashionColorId: 11 },
    ]);
    // liveById vide simule le lag du cache eFashion juste après le publish.
    listProductsMock.mockResolvedValue({ items: [] });

    const res = await efashionUpdateProductInPlace("p4", {
      forceFullSync: true,
      isPostPublishAlignment: true,
    });

    expect(res.colorsSkippedCount ?? 0).toBe(0);
  });
});
