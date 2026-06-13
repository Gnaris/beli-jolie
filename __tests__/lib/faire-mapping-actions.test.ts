import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma + next-auth + next/cache so server actions run in isolation.
// Use vi.hoisted() so the spies are available when vi.mock() runs at top.
const { updateCategory, updateComposition } = vi.hoisted(() => ({
  updateCategory: vi.fn(),
  updateComposition: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { update: updateCategory },
    composition: { update: updateComposition },
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

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateSubCategory: vi.fn(),
}));

vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: ["en"] }));

import {
  updateCategoryFaireTaxonomy,
  updateCategoryFaireHsCode,
} from "@/app/actions/admin/categories";
import { updateCompositionFaireMaterial } from "@/app/actions/admin/compositions";

describe("updateCategoryFaireTaxonomy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("met à jour faireTaxonomyId avec valeur trimée", async () => {
    await updateCategoryFaireTaxonomy("cat_1", "  tx_jewelry_bracelets  ");
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      data: { faireTaxonomyId: "tx_jewelry_bracelets" },
    });
  });

  it("convertit chaîne vide en null (suppression)", async () => {
    await updateCategoryFaireTaxonomy("cat_1", "   ");
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      data: { faireTaxonomyId: null },
    });
  });

  it("convertit null en null", async () => {
    await updateCategoryFaireTaxonomy("cat_1", null);
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      data: { faireTaxonomyId: null },
    });
  });
});

describe("updateCategoryFaireHsCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("met à jour faireHsCode avec valeur trimée", async () => {
    await updateCategoryFaireHsCode("cat_1", " 7117.19.00 ");
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      data: { faireHsCode: "7117.19.00" },
    });
  });

  it("accepte n'importe quel code (générique tous types de produits — bijoux, textile, lunettes…)", async () => {
    await updateCategoryFaireHsCode("cat_2", "6109.10.00");
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_2" },
      data: { faireHsCode: "6109.10.00" },
    });
  });

  it("vide → null", async () => {
    await updateCategoryFaireHsCode("cat_1", "");
    expect(updateCategory).toHaveBeenCalledWith({
      where: { id: "cat_1" },
      data: { faireHsCode: null },
    });
  });
});

describe("updateCompositionFaireMaterial", () => {
  beforeEach(() => vi.clearAllMocks());

  it("met à jour faireMaterialLabel avec valeur trimée", async () => {
    await updateCompositionFaireMaterial("comp_1", "  Stainless Steel 316L  ");
    expect(updateComposition).toHaveBeenCalledWith({
      where: { id: "comp_1" },
      data: { faireMaterialLabel: "Stainless Steel 316L" },
    });
  });

  it("accepte libellés non-bijoux (cuir, coton, etc. — générique)", async () => {
    await updateCompositionFaireMaterial("comp_2", "100% Cotton");
    expect(updateComposition).toHaveBeenCalledWith({
      where: { id: "comp_2" },
      data: { faireMaterialLabel: "100% Cotton" },
    });
  });

  it("vide → null", async () => {
    await updateCompositionFaireMaterial("comp_1", "  ");
    expect(updateComposition).toHaveBeenCalledWith({
      where: { id: "comp_1" },
      data: { faireMaterialLabel: null },
    });
  });
});
