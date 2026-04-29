import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryCreate = vi.fn();
const mockCategoryFindFirst = vi.fn();
const mockCategoryUpdate = vi.fn();
const mockCategoryTranslationUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      create: (...a: unknown[]) => mockCategoryCreate(...a),
      findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
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
 * Lors de l'import PFS, le modal pré-rempli transmet l'ID Salesforce PFS
 * (`pfsCategoryId`) en plus du trio genre/famille/catégorie. Sans ça, le
 * re-scan ne retrouverait pas la catégorie et laisserait la ligne "à créer"
 * indéfiniment — on vérifie que l'ID est bien enregistré.
 */
describe("createCategoryQuick — enregistre le pfsCategoryId de l'import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindFirst.mockResolvedValue(null);
    mockCategoryCreate.mockResolvedValue({ id: "cat-local-1", name: "Bagues" });
  });

  it("passe pfsCategoryId dans le data Prisma quand fourni", async () => {
    await createCategoryQuick(
      { fr: "Bagues" },
      "WOMAN",
      "Bijoux_Fantaisie",
      "Bagues",
      "a045J000003KWwDQAW",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "Bagues",
        pfsGender: "WOMAN",
        pfsFamilyName: "Bijoux_Fantaisie",
        pfsCategoryName: "Bagues",
        pfsCategoryId: "a045J000003KWwDQAW",
      }),
    }));
  });

  it("met pfsCategoryId à null quand non fourni (création manuelle classique)", async () => {
    await createCategoryQuick(
      { fr: "Bagues" },
      "WOMAN",
      "Bijoux_Fantaisie",
      "Bagues",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pfsCategoryId: null,
      }),
    }));
  });

  it("trim le pfsCategoryId et renvoie null si vide", async () => {
    await createCategoryQuick(
      { fr: "Bagues" },
      "WOMAN",
      "Bijoux_Fantaisie",
      "Bagues",
      "   ",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pfsCategoryId: null,
      }),
    }));
  });
});
