import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryFindFirst = vi.fn();
const mockCategoryCreate = vi.fn();
const mockCategoryUpdate = vi.fn();
const mockSubCategoryFindFirst = vi.fn();
const mockSubCategoryCreate = vi.fn();
const mockSubCategoryFindMany = vi.fn().mockResolvedValue([]);
const mockCompositionFindFirst = vi.fn();
const mockCompositionCreate = vi.fn();
const mockSeasonFindFirst = vi.fn();
const mockSeasonCreate = vi.fn();
const mockTagUpsert = vi.fn();
const mockUpsertTranslation = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
      create: (...a: unknown[]) => mockCategoryCreate(...a),
      update: (...a: unknown[]) => mockCategoryUpdate(...a),
    },
    subCategory: {
      findFirst: (...a: unknown[]) => mockSubCategoryFindFirst(...a),
      create: (...a: unknown[]) => mockSubCategoryCreate(...a),
      findMany: (...a: unknown[]) => mockSubCategoryFindMany(...a),
    },
    composition: {
      findFirst: (...a: unknown[]) => mockCompositionFindFirst(...a),
      create: (...a: unknown[]) => mockCompositionCreate(...a),
    },
    season: {
      findFirst: (...a: unknown[]) => mockSeasonFindFirst(...a),
      create: (...a: unknown[]) => mockSeasonCreate(...a),
    },
    tag: { upsert: (...a: unknown[]) => mockTagUpsert(...a) },
    categoryTranslation: { upsert: (...a: unknown[]) => mockUpsertTranslation(...a) },
    subCategoryTranslation: { upsert: (...a: unknown[]) => mockUpsertTranslation(...a) },
    compositionTranslation: { upsert: (...a: unknown[]) => mockUpsertTranslation(...a) },
    seasonTranslation: { upsert: (...a: unknown[]) => mockUpsertTranslation(...a) },
    tagTranslation: { upsert: (...a: unknown[]) => mockUpsertTranslation(...a) },
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

const mockAutoTranslateCategory = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateSubCategory = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateComposition = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateColor = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateManufacturingCountry = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateSeason = vi.fn().mockResolvedValue(undefined);
const mockAutoTranslateTag = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: (...a: unknown[]) => mockAutoTranslateCategory(...a),
  autoTranslateSubCategory: (...a: unknown[]) => mockAutoTranslateSubCategory(...a),
  autoTranslateComposition: (...a: unknown[]) => mockAutoTranslateComposition(...a),
  autoTranslateColor: (...a: unknown[]) => mockAutoTranslateColor(...a),
  autoTranslateManufacturingCountry: (...a: unknown[]) => mockAutoTranslateManufacturingCountry(...a),
  autoTranslateSeason: (...a: unknown[]) => mockAutoTranslateSeason(...a),
  autoTranslateTag: (...a: unknown[]) => mockAutoTranslateTag(...a),
}));

import {
  createCategoryQuick,
  createSubCategoryQuick,
  createCompositionQuick,
  createSeasonQuick,
  createTagQuick,
} from "@/app/actions/admin/quick-create";

/**
 * Bug : la modale "Créer une catégorie" affichait le badge vert
 * « Traduction auto » mais l'auto-traduction n'était jamais déclenchée côté
 * serveur — seul le nom FR était enregistré et l'EN restait vide. On vérifie
 * que chaque quick-create branche bien l'auto-traduction.
 */
describe("quick-create — déclenche l'auto-traduction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindFirst.mockResolvedValue(null);
    mockCategoryCreate.mockResolvedValue({ id: "cat-1", name: "Bagues" });
    mockSubCategoryFindFirst.mockResolvedValue(null);
    mockSubCategoryCreate.mockResolvedValue({ id: "sub-1", name: "Argent" });
    mockCompositionFindFirst.mockResolvedValue(null);
    mockCompositionCreate.mockResolvedValue({ id: "comp-1", name: "Acier inoxydable" });
    mockSeasonFindFirst.mockResolvedValue(null);
    mockSeasonCreate.mockResolvedValue({ id: "season-1", name: "Été 2026" });
    mockTagUpsert.mockResolvedValue({ id: "tag-1", name: "tendance" });
  });

  it("createCategoryQuick lance autoTranslateCategory sur création", async () => {
    await createCategoryQuick({ fr: "Bagues" }, "WOMAN", "Bijoux_Fantaisie", "Bagues");
    expect(mockAutoTranslateCategory).toHaveBeenCalledWith("cat-1", "Bagues", []);
  });

  it("createCategoryQuick exclut les locales saisies manuellement", async () => {
    await createCategoryQuick(
      { fr: "Bagues", en: "Rings" },
      "WOMAN",
      "Bijoux_Fantaisie",
      "Bagues",
    );
    expect(mockAutoTranslateCategory).toHaveBeenCalledWith("cat-1", "Bagues", ["en"]);
  });

  it("createCategoryQuick lance aussi l'auto-traduction sur catégorie existante", async () => {
    mockCategoryFindFirst.mockResolvedValueOnce({ id: "cat-existing", name: "Bagues" });
    mockCategoryUpdate.mockResolvedValueOnce({ id: "cat-existing", name: "Bagues" });
    mockSubCategoryFindMany.mockResolvedValueOnce([]);
    await createCategoryQuick({ fr: "Bagues" }, "WOMAN", "Bijoux_Fantaisie", "Bagues");
    expect(mockAutoTranslateCategory).toHaveBeenCalledWith("cat-existing", "Bagues", []);
  });

  it("createSubCategoryQuick lance autoTranslateSubCategory", async () => {
    await createSubCategoryQuick({ fr: "Argent" }, "cat-1");
    expect(mockAutoTranslateSubCategory).toHaveBeenCalledWith("sub-1", "Argent", []);
  });

  it("createCompositionQuick lance autoTranslateComposition", async () => {
    await createCompositionQuick({ fr: "Acier inoxydable" }, "INOX");
    expect(mockAutoTranslateComposition).toHaveBeenCalledWith("comp-1", "Acier inoxydable", []);
  });

  it("createSeasonQuick lance autoTranslateSeason", async () => {
    await createSeasonQuick({ fr: "Été 2026" }, "SS26");
    expect(mockAutoTranslateSeason).toHaveBeenCalledWith("season-1", "Été 2026", []);
  });

  it("createTagQuick lance autoTranslateTag", async () => {
    await createTagQuick({ fr: "tendance" });
    expect(mockAutoTranslateTag).toHaveBeenCalledWith("tag-1", "tendance", []);
  });
});
