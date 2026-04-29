import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryFindFirst = vi.fn();
const mockCategoryCreate = vi.fn();
const mockCategoryUpdate = vi.fn();
const mockCategoryTranslationUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
      create: (...a: unknown[]) => mockCategoryCreate(...a),
      update: (...a: unknown[]) => mockCategoryUpdate(...a),
    },
    categoryTranslation: { upsert: (...a: unknown[]) => mockCategoryTranslationUpsert(...a) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { createCategoryQuick } from "@/app/actions/admin/quick-create";

/**
 * Bug : la modale "Correspondance" pouvait transmettre un identifiant
 * Salesforce brut comme `pfsFamilyName` (ex: "a035J00000185J7QAI") quand
 * `pfsGetFamilies()` n'avait pas pu résoudre le code. On vérifie que la
 * server action refuse ces valeurs au lieu d'écrire un mapping inutilisable
 * dans la BDD.
 */
describe("createCategoryQuick — rejet des IDs Salesforce comme pfsFamilyName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindFirst.mockResolvedValue(null);
    mockCategoryCreate.mockResolvedValue({ id: "cat-local-1", name: "Bagues" });
  });

  it("rejette un identifiant Salesforce brut (a035…) en pfsFamilyName", async () => {
    await expect(
      createCategoryQuick({ fr: "Bagues" }, "WOMAN", "a035J00000185J7QAI", "Bagues"),
    ).rejects.toThrow(/Paris Fashion Shop/);
    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it("rejette une famille inconnue de la taxonomie", async () => {
    await expect(
      createCategoryQuick({ fr: "Bagues" }, "WOMAN", "Famille_Bidon", "Bagues"),
    ).rejects.toThrow(/Paris Fashion Shop/);
    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it("accepte une famille connue de la taxonomie", async () => {
    await createCategoryQuick(
      { fr: "Bagues" },
      "WOMAN",
      "Bijoux_Fantaisie",
      "Bagues",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pfsFamilyName: "Bijoux_Fantaisie",
      }),
    }));
  });

  it("trim les espaces autour de la famille avant validation", async () => {
    await createCategoryQuick(
      { fr: "Bagues" },
      "WOMAN",
      "  Bijoux_Fantaisie  ",
      "Bagues",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pfsFamilyName: "Bijoux_Fantaisie",
      }),
    }));
  });
});
