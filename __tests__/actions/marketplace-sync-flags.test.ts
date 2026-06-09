/**
 * Tests unitaires des actions de drapeaux « Synchronisation nécessaire ».
 *
 * - `clearSyncRequiredFlag` : remet à false le drapeau par marketplace
 *   quand l'utilisatrice clique le X de cancel sur un badge orange.
 * - `canTriggerResync` : vérifie que le produit est bien lié au
 *   marketplace ciblé avant qu'on déclenche une resync.
 *
 * Prisma + next-auth sont mockés (pas d'accès BDD).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "u", role: "ADMIN", status: "APPROVED", email: "a@b.c" },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));

const prismaMock: any = {
  product: {
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { clearSyncRequiredFlag, canTriggerResync } = await import(
  "@/app/actions/admin/marketplace-sync-flags"
);

beforeEach(() => {
  prismaMock.product.update.mockReset();
  prismaMock.product.update.mockResolvedValue({});
  prismaMock.product.findUnique.mockReset();
});

describe("clearSyncRequiredFlag", () => {
  it("remet pfsSyncRequired à false pour PFS", async () => {
    const out = await clearSyncRequiredFlag("p-1", "pfs");
    expect(out.success).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "p-1" },
      data: { pfsSyncRequired: false },
    });
  });

  it("remet ankorsSyncRequired à false pour Ankorstore", async () => {
    await clearSyncRequiredFlag("p-1", "ankorstore");
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "p-1" },
      data: { ankorsSyncRequired: false },
    });
  });

  it("remet efashionSyncRequired à false pour eFashion", async () => {
    await clearSyncRequiredFlag("p-1", "efashion");
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "p-1" },
      data: { efashionSyncRequired: false },
    });
  });

  it("renvoie success:false avec le message d'erreur si Prisma échoue", async () => {
    prismaMock.product.update.mockRejectedValue(new Error("boom"));
    const out = await clearSyncRequiredFlag("p-1", "pfs");
    expect(out.success).toBe(false);
    expect(out.error).toBe("boom");
  });
});

describe("canTriggerResync", () => {
  it("OK quand le produit est lié à PFS", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      pfsProductId: "pfs-123",
      ankorsProductId: null,
      efashionReferenceBase: null,
    });
    const out = await canTriggerResync("p-1", "pfs");
    expect(out).toEqual({ ok: true });
  });

  it("KO quand le produit n'est pas lié à PFS", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      pfsProductId: null,
      ankorsProductId: "ak-1",
      efashionReferenceBase: null,
    });
    const out = await canTriggerResync("p-1", "pfs");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/Paris Fashion Shop/);
  });

  it("KO pour Ankorstore si non lié, OK pour les autres si liés", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      pfsProductId: "pfs-x",
      ankorsProductId: null,
      efashionReferenceBase: "REF-BASE-1",
    });
    expect((await canTriggerResync("p-1", "ankorstore")).ok).toBe(false);
    expect((await canTriggerResync("p-1", "efashion")).ok).toBe(true);
    expect((await canTriggerResync("p-1", "pfs")).ok).toBe(true);
  });

  it("KO quand le produit n'existe pas", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    const out = await canTriggerResync("p-fantôme", "pfs");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/introuvable/);
  });
});
