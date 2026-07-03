/**
 * Tests pour lib/rotate-primary-service.ts.
 *
 * Couvre :
 *  - Pas de produit → no-op.
 *  - Primary toujours en stock → no-op, pas d'update BDD, pas de push.
 *  - Rotation → update primaryColorId + push aux marketplaces liées.
 *  - Ankorstore désactivé via kill switch → pas de push Ankorstore.
 *  - Produit non lié à une marketplace → pas de push pour celle-ci.
 *  - Erreur d'une marketplace n'empêche pas le retour de rotated:true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockProductFindUnique = vi.fn();
const mockProductUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      update: (...args: unknown[]) => mockProductUpdate(...args),
    },
  },
}));

const mockPfsUpdate = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/lib/pfs-update", () => ({
  pfsUpdateProductInPlace: (...args: unknown[]) => mockPfsUpdate(...args),
}));

const mockAnkorstoreEnabled = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/cached-data", () => ({
  getCachedAnkorstoreEnabled: () => mockAnkorstoreEnabled(),
}));

const mockAnkorstoreKickoff = vi.fn().mockResolvedValue({ success: true, operationId: "op-1" });
vi.mock("@/lib/ankorstore-update", () => ({
  ankorstoreKickoffUpdate: (...args: unknown[]) => mockAnkorstoreKickoff(...args),
}));

const mockEfashionUpdate = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/lib/efashion-update", () => ({
  efashionUpdateProductInPlace: (...args: unknown[]) => mockEfashionUpdate(...args),
}));

import { rotatePrimaryIfNeeded } from "@/lib/rotate-primary-service";

beforeEach(() => {
  vi.clearAllMocks();
  mockAnkorstoreEnabled.mockResolvedValue(true);
  mockPfsUpdate.mockResolvedValue({ success: true });
  mockAnkorstoreKickoff.mockResolvedValue({ success: true, operationId: "op-1" });
  mockEfashionUpdate.mockResolvedValue({ success: true });
});

// Petit helper : attend que les tâches micro-task et timers en attente passent
// (le service appelle les pushes via `void` non-await).
const flushBackground = () => new Promise<void>((r) => setImmediate(r));

describe("rotatePrimaryIfNeeded", () => {
  it("no-op si le produit n'existe pas", async () => {
    mockProductFindUnique.mockResolvedValueOnce(null);
    const result = await rotatePrimaryIfNeeded("missing");
    expect(result.rotated).toBe(false);
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("no-op si la primary actuelle a encore du stock", async () => {
    mockProductFindUnique.mockResolvedValueOnce({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: "pfs-1",
      ankorsProductId: null,
      efashionReferenceBase: null,
      colors: [
        { colorId: "rouge", stock: 5, disabled: false },
        { colorId: "kaki", stock: 2, disabled: false },
      ],
    });

    const result = await rotatePrimaryIfNeeded("p1");
    expect(result).toEqual({
      rotated: false,
      oldPrimaryColorId: "rouge",
      newPrimaryColorId: "rouge",
    });
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockPfsUpdate).not.toHaveBeenCalled();
  });

  it("bascule la primaire et push aux 3 marketplaces liées", async () => {
    mockProductFindUnique.mockResolvedValueOnce({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: "pfs-1",
      ankorsProductId: "ank-1",
      efashionReferenceBase: "REF-EF",
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    const result = await rotatePrimaryIfNeeded("p1");
    expect(result).toEqual({
      rotated: true,
      oldPrimaryColorId: "rouge",
      newPrimaryColorId: "kaki",
    });

    expect(mockProductUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { primaryColorId: "kaki" },
    });

    await flushBackground();
    expect(mockPfsUpdate).toHaveBeenCalledWith(
      "p1",
      undefined,
      { skipRevalidation: true },
    );
    expect(mockAnkorstoreKickoff).toHaveBeenCalledWith("p1", { skipRevalidation: true });
    expect(mockEfashionUpdate).toHaveBeenCalledWith("p1");
  });

  it("ne push pas Ankorstore quand le kill switch est désactivé", async () => {
    mockAnkorstoreEnabled.mockResolvedValueOnce(false);
    mockProductFindUnique.mockResolvedValueOnce({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: null,
      ankorsProductId: "ank-1",
      efashionReferenceBase: null,
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    const result = await rotatePrimaryIfNeeded("p1");
    expect(result.rotated).toBe(true);

    await flushBackground();
    expect(mockAnkorstoreKickoff).not.toHaveBeenCalled();
  });

  it("ne push pas les marketplaces non liées", async () => {
    mockProductFindUnique.mockResolvedValueOnce({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: null,
      ankorsProductId: null,
      efashionReferenceBase: null,
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    await rotatePrimaryIfNeeded("p1");
    await flushBackground();

    expect(mockPfsUpdate).not.toHaveBeenCalled();
    expect(mockAnkorstoreKickoff).not.toHaveBeenCalled();
    expect(mockEfashionUpdate).not.toHaveBeenCalled();
  });

  it("retourne rotated:true même si un push marketplace échoue", async () => {
    mockPfsUpdate.mockRejectedValueOnce(new Error("PFS down"));
    mockProductFindUnique.mockResolvedValueOnce({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: "pfs-1",
      ankorsProductId: null,
      efashionReferenceBase: null,
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    const result = await rotatePrimaryIfNeeded("p1");
    expect(result.rotated).toBe(true);
    expect(result.newPrimaryColorId).toBe("kaki");

    await flushBackground();
    expect(mockPfsUpdate).toHaveBeenCalled();
  });

  it("dédoublonne les appels concurrents sur le même produit (verrou en mémoire)", async () => {
    // Reproduit la course qui provoquait « Ankorstore API 403: Status cannot
    // be updated from [started] to [started] » sur le VPS le 2026-07-03 :
    // trois `rotatePrimaryIfNeeded("A382")` déclenchés dans la même frame
    // (bulkUpdateVariants + placeOrder + updateVariantQuick), chacun lisait
    // le même état initial et lançait son propre push Ankorstore.
    // Avec le verrou, seul le premier appel doit lancer le push.
    let resolveFind: ((v: unknown) => void) | null = null;
    mockProductFindUnique.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFind = r;
        }),
    );

    const p1 = rotatePrimaryIfNeeded("p1");
    const p2 = rotatePrimaryIfNeeded("p1");
    const p3 = rotatePrimaryIfNeeded("p1");

    // Le second et le troisième appel doivent renvoyer la même promesse que
    // le premier — pas de nouvel appel Prisma tant que le premier n'a pas
    // fini.
    expect(mockProductFindUnique).toHaveBeenCalledTimes(1);

    resolveFind!({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: "pfs-1",
      ankorsProductId: "ank-1",
      efashionReferenceBase: "REF-EF",
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(r1.rotated).toBe(true);

    await flushBackground();
    // Un seul push par marketplace malgré les 3 appels.
    expect(mockPfsUpdate).toHaveBeenCalledTimes(1);
    expect(mockAnkorstoreKickoff).toHaveBeenCalledTimes(1);
    expect(mockEfashionUpdate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it("libère le verrou après complétion pour permettre une nouvelle rotation ultérieure", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p1",
      primaryColorId: "rouge",
      pfsProductId: "pfs-1",
      ankorsProductId: null,
      efashionReferenceBase: null,
      colors: [
        { colorId: "rouge", stock: 0, disabled: false },
        { colorId: "kaki", stock: 4, disabled: false },
      ],
    });

    await rotatePrimaryIfNeeded("p1");
    await flushBackground();
    await rotatePrimaryIfNeeded("p1");
    await flushBackground();

    // Chaque cycle indépendant lit à nouveau la BDD.
    expect(mockProductFindUnique).toHaveBeenCalledTimes(2);
  });
});
