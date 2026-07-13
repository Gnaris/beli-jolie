import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryCreate = vi.fn();
const mockCategoryFindFirst = vi.fn();
const mockCategoryUpdate = vi.fn();
const mockCategoryTranslationUpsert = vi.fn();
const mockSubCategoryFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      create: (...a: unknown[]) => mockCategoryCreate(...a),
      findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
      update: (...a: unknown[]) => mockCategoryUpdate(...a),
    },
    categoryTranslation: { upsert: (...a: unknown[]) => mockCategoryTranslationUpsert(...a) },
    subCategory: { findMany: (...a: unknown[]) => mockSubCategoryFindMany(...a) },
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
 * Régression : à la création d'une catégorie via la modale, si l'admin a
 * choisi un `taxonomy_type.id` Faire, il doit être persisté immédiatement.
 * Avant le fix, le champ n'était sauvegardé qu'à la ré-édition de la fiche.
 */
describe("createCategoryQuick — enregistre le faireTaxonomyId dès la création", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindFirst.mockResolvedValue(null);
    mockCategoryCreate.mockResolvedValue({ id: "cat-1", name: "Jupes" });
    mockSubCategoryFindMany.mockResolvedValue([]);
  });

  it("passe faireTaxonomyId dans le create Prisma quand fourni", async () => {
    await createCategoryQuick(
      { fr: "Jupes" },
      "WOMAN",
      "Bijoux_Fantaisie",
      null,
      null,
      null,
      "tt_taxonomy_apparel_skirts",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        faireTaxonomyId: "tt_taxonomy_apparel_skirts",
      }),
    }));
  });

  it("met faireTaxonomyId à null quand non fourni (mapping Faire non choisi)", async () => {
    await createCategoryQuick(
      { fr: "Jupes" },
      "WOMAN",
      "Bijoux_Fantaisie",
    );
    expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        faireTaxonomyId: null,
      }),
    }));
  });

  it("met à jour faireTaxonomyId sur une catégorie existante du même nom", async () => {
    mockCategoryFindFirst.mockResolvedValue({ id: "cat-existing", name: "Robes" });
    await createCategoryQuick(
      { fr: "Robes" },
      "WOMAN",
      "Bijoux_Fantaisie",
      null,
      null,
      null,
      "tt_taxonomy_apparel_dresses",
    );
    expect(mockCategoryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cat-existing" },
      data: expect.objectContaining({
        faireTaxonomyId: "tt_taxonomy_apparel_dresses",
      }),
    }));
  });
});
