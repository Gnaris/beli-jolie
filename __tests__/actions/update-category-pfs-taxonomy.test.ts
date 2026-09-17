import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryFindUnique = vi.fn();
const mockCategoryUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findUnique: (...a: unknown[]) => mockCategoryFindUnique(...a),
      update: (...a: unknown[]) => mockCategoryUpdate(...a),
    },
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
vi.mock("@/lib/mapping-impact", () => ({
  buildMappingImpactSummary: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateSubCategory: vi.fn(),
}));
vi.mock("@/lib/translate", () => ({ translateText: vi.fn() }));

import { updateCategoryPfsTaxonomy } from "@/app/actions/admin/categories";

/**
 * Bug prod 2026-09-17 : quand la cliente change le Genre ou la Famille PFS
 * d'une catégorie dans les Paramètres, les IDs Salesforce précédemment résolus
 * (pfsFamilyId, pfsCategoryId) restent en base. Au prochain push PFS,
 * `resolvePfsCategoryIds` sort en early return (les 2 IDs sont non-null) et
 * on envoie à PFS des IDs qui ne matchent plus les nouveaux noms → 422
 * « family: Famille non valide ». Reproduit sur produit PC6 (catégorie
 * Porte-clé, SUPPLIES/Lifestyle mappée mais pfsFamilyId pointait toujours sur
 * Bijoux_Fantaisie WOMAN — a035J00000185J7QAI).
 */
describe("updateCategoryPfsTaxonomy — reset des IDs Salesforce sur changement de mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("efface pfsFamilyId ET pfsCategoryId quand le genre change", async () => {
    mockCategoryFindUnique.mockResolvedValue({
      name: "Porte-clé",
      pfsGender: "WOMAN",
      pfsFamilyName: "Bijoux_Fantaisie",
      pfsCategoryName: "Bagues",
      pfsFamilyId: "a035J00000185J7QAI",
      pfsCategoryId: "a045J000003KWw8QAG",
    });

    await updateCategoryPfsTaxonomy("cat-1", "SUPPLIES", "Lifestyle", "Porte-clés");

    expect(mockCategoryUpdate).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: {
        pfsGender: "SUPPLIES",
        pfsFamilyName: "Lifestyle",
        pfsCategoryName: "Porte-clés",
        pfsFamilyId: null,
        pfsCategoryId: null,
      },
    });
  });

  it("efface pfsFamilyId ET pfsCategoryId quand la famille change (même genre)", async () => {
    mockCategoryFindUnique.mockResolvedValue({
      name: "Cat",
      pfsGender: "WOMAN",
      pfsFamilyName: "Bijoux_Fantaisie",
      pfsCategoryName: "Bagues",
      pfsFamilyId: "fam-old",
      pfsCategoryId: "cat-old",
    });

    await updateCategoryPfsTaxonomy("cat-2", "WOMAN", "Accessoires", "Ceintures");

    expect(mockCategoryUpdate).toHaveBeenCalledWith({
      where: { id: "cat-2" },
      data: {
        pfsGender: "WOMAN",
        pfsFamilyName: "Accessoires",
        pfsCategoryName: "Ceintures",
        pfsFamilyId: null,
        pfsCategoryId: null,
      },
    });
  });

  it("efface uniquement pfsCategoryId quand la sous-catégorie change (même famille)", async () => {
    mockCategoryFindUnique.mockResolvedValue({
      name: "Cat",
      pfsGender: "WOMAN",
      pfsFamilyName: "Bijoux_Fantaisie",
      pfsCategoryName: "Bagues",
      pfsFamilyId: "fam-keep",
      pfsCategoryId: "cat-old",
    });

    await updateCategoryPfsTaxonomy("cat-3", "WOMAN", "Bijoux_Fantaisie", "Colliers");

    const call = mockCategoryUpdate.mock.calls[0][0];
    expect(call.data.pfsFamilyId).toBeUndefined();
    expect(call.data.pfsCategoryId).toBeNull();
    expect(call.data.pfsFamilyName).toBe("Bijoux_Fantaisie");
    expect(call.data.pfsCategoryName).toBe("Colliers");
  });

  it("ne touche pas aux IDs quand rien ne change", async () => {
    mockCategoryFindUnique.mockResolvedValue({
      name: "Cat",
      pfsGender: "WOMAN",
      pfsFamilyName: "Bijoux_Fantaisie",
      pfsCategoryName: "Bagues",
      pfsFamilyId: "fam-keep",
      pfsCategoryId: "cat-keep",
    });

    await updateCategoryPfsTaxonomy("cat-4", "WOMAN", "Bijoux_Fantaisie", "Bagues");

    const call = mockCategoryUpdate.mock.calls[0][0];
    expect(call.data.pfsFamilyId).toBeUndefined();
    expect(call.data.pfsCategoryId).toBeUndefined();
  });
});
