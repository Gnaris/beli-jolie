/**
 * Tests unitaires de `updateCompositionPfsRef`.
 *
 * Depuis 2026-09-03, plusieurs compositions BJ peuvent partager la même
 * référence PFS (comme les Saisons). Le test principal vérifie qu'il n'y a
 * plus de refus « Cette référence PFS est déjà utilisée par la composition X ».
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

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateComposition: vi.fn(),
}));

vi.mock("@/lib/mapping-impact", () => ({
  buildMappingImpactSummary: vi.fn().mockResolvedValue(null),
}));

const prismaMock: any = {
  composition: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { updateCompositionPfsRef } = await import("@/app/actions/admin/compositions");

beforeEach(() => {
  prismaMock.composition.findFirst.mockReset();
  prismaMock.composition.findUnique.mockReset();
  prismaMock.composition.update.mockReset().mockResolvedValue({});
});

describe("updateCompositionPfsRef", () => {
  it("autorise deux compositions à partager la même référence PFS", async () => {
    // Simule une autre composition qui utilise déjà la ref « ACIERINOX » —
    // avant le fix, cet appel throwait « déjà utilisée par… ».
    prismaMock.composition.findUnique.mockResolvedValue({
      name: "Acier 304",
      pfsCompositionRef: null,
    });

    const res = await updateCompositionPfsRef("c-nouveau", "ACIERINOX");

    expect(res.success).toBe(true);
    expect(prismaMock.composition.update).toHaveBeenCalledWith({
      where: { id: "c-nouveau" },
      data: { pfsCompositionRef: "ACIERINOX" },
    });
    // On ne doit plus faire le pré-check d'unicité.
    expect(prismaMock.composition.findFirst).not.toHaveBeenCalled();
  });

  it("normalise en null quand la ref est vide", async () => {
    prismaMock.composition.findUnique.mockResolvedValue({
      name: "Coton",
      pfsCompositionRef: "COTON",
    });

    await updateCompositionPfsRef("c-1", "  ");

    expect(prismaMock.composition.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { pfsCompositionRef: null },
    });
  });

  it("retourne impact:null si la ref n'a pas changé", async () => {
    prismaMock.composition.findUnique.mockResolvedValue({
      name: "Coton",
      pfsCompositionRef: "COTON",
    });

    const res = await updateCompositionPfsRef("c-1", "COTON");

    expect(res).toEqual({ success: true, impact: null });
  });

  it("lève « Composition introuvable » si l'id n'existe pas", async () => {
    prismaMock.composition.findUnique.mockResolvedValue(null);

    await expect(updateCompositionPfsRef("c-inconnu", "LAITON")).rejects.toThrow(
      "Composition introuvable.",
    );
  });
});
