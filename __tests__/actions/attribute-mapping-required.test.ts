import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryCreate = vi.fn();
const mockColorCreate = vi.fn();
const mockSeasonCreate = vi.fn();
const mockCountryCreate = vi.fn();

const mockCategoryTranslationUpsert = vi.fn();
const mockColorTranslationUpsert = vi.fn();
const mockSeasonTranslationUpsert = vi.fn();
const mockCountryTranslationUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { create: (...a: unknown[]) => mockCategoryCreate(...a) },
    color: { create: (...a: unknown[]) => mockColorCreate(...a) },
    season: { create: (...a: unknown[]) => mockSeasonCreate(...a) },
    manufacturingCountry: { create: (...a: unknown[]) => mockCountryCreate(...a) },
    categoryTranslation: { upsert: (...a: unknown[]) => mockCategoryTranslationUpsert(...a) },
    colorTranslation: { upsert: (...a: unknown[]) => mockColorTranslationUpsert(...a) },
    seasonTranslation: { upsert: (...a: unknown[]) => mockSeasonTranslationUpsert(...a) },
    manufacturingCountryTranslation: { upsert: (...a: unknown[]) => mockCountryTranslationUpsert(...a) },
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
  autoTranslateColor: vi.fn(),
  autoTranslateSeason: vi.fn(),
  autoTranslateManufacturingCountry: vi.fn(),
}));

import { createCategory } from "@/app/actions/admin/categories";
import { createColor } from "@/app/actions/admin/colors";
import { createSeason } from "@/app/actions/admin/seasons";
import { createManufacturingCountry } from "@/app/actions/admin/manufacturing-countries";
import {
  createCategoryQuick,
  createColorQuick,
  createSeasonQuick,
  createManufacturingCountryQuick,
} from "@/app/actions/admin/quick-create";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("attribute creation — PFS mapping is required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryCreate.mockResolvedValue({ id: "c1", name: "Bagues" });
    mockColorCreate.mockResolvedValue({ id: "col1", name: "Noir", hex: null, patternImage: null });
    mockSeasonCreate.mockResolvedValue({ id: "s1", name: "PE 2026" });
    mockCountryCreate.mockResolvedValue({ id: "co1", name: "Chine" });
  });

  // ── createCategory (form-based) ──
  describe("createCategory", () => {
    it("throws when pfsGender is missing", async () => {
      await expect(
        createCategory(fd({ name: "Bagues", pfsFamilyName: "Bijoux" }))
      ).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockCategoryCreate).not.toHaveBeenCalled();
    });

    it("throws when pfsFamilyName is missing", async () => {
      await expect(
        createCategory(fd({ name: "Bagues", pfsGender: "WOMAN" }))
      ).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockCategoryCreate).not.toHaveBeenCalled();
    });

    it("creates when gender + family are both provided", async () => {
      await createCategory(fd({
        name: "Bagues",
        pfsGender: "WOMAN",
        pfsFamilyName: "Bijoux_Fantaisie",
        pfsCategoryName: "Bagues",
      }));
      expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          pfsGender: "WOMAN",
          pfsFamilyName: "Bijoux_Fantaisie",
          pfsCategoryName: "Bagues",
        }),
      }));
    });
  });

  // ── createColor (form-based) ──
  describe("createColor", () => {
    it("throws when pfsColorRef is missing", async () => {
      await expect(createColor(fd({ name: "Noir" }))).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockColorCreate).not.toHaveBeenCalled();
    });

    it("creates when pfsColorRef is provided", async () => {
      await createColor(fd({ name: "Noir", pfsColorRef: "Noir" }));
      expect(mockColorCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ pfsColorRef: "Noir" }),
      }));
    });
  });

  // ── createSeason (form-based) ──
  describe("createSeason", () => {
    it("throws when pfsRef is missing", async () => {
      await expect(createSeason(fd({ name: "PE 2026" }))).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockSeasonCreate).not.toHaveBeenCalled();
    });

    it("creates with uppercased pfsRef", async () => {
      await createSeason(fd({ name: "PE 2026", pfsRef: "pe2026" }));
      expect(mockSeasonCreate).toHaveBeenCalledWith({ data: { name: "PE 2026", pfsRef: "PE2026" } });
    });
  });

  // ── createManufacturingCountry (form-based) ──
  describe("createManufacturingCountry", () => {
    it("throws when pfsCountryRef is missing", async () => {
      await expect(
        createManufacturingCountry(fd({ name: "Chine", isoCode: "CN" }))
      ).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("creates when pfsCountryRef is provided", async () => {
      await createManufacturingCountry(fd({ name: "Chine", isoCode: "CN", pfsCountryRef: "CN" }));
      expect(mockCountryCreate).toHaveBeenCalledWith({
        data: { name: "Chine", isoCode: "CN", pfsCountryRef: "CN" },
      });
    });
  });

  // ── Quick-create variants ──
  describe("quick-create actions", () => {
    it("createCategoryQuick throws without gender/family", async () => {
      await expect(createCategoryQuick({ fr: "Bagues" })).rejects.toThrow(/Paris Fashion Shop/);
      await expect(createCategoryQuick({ fr: "Bagues" }, "WOMAN")).rejects.toThrow(/Paris Fashion Shop/);
    });

    it("createCategoryQuick succeeds with gender + family", async () => {
      await createCategoryQuick({ fr: "Bagues" }, "WOMAN", "Bijoux_Fantaisie", "Bagues");
      expect(mockCategoryCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          pfsGender: "WOMAN",
          pfsFamilyName: "Bijoux_Fantaisie",
          pfsCategoryName: "Bagues",
        }),
      }));
    });

    it("createColorQuick throws without pfsColorRef", async () => {
      await expect(createColorQuick({ fr: "Noir" }, "#000", null)).rejects.toThrow(/Paris Fashion Shop/);
    });

    it("createColorQuick succeeds with pfsColorRef", async () => {
      await createColorQuick({ fr: "Noir" }, "#000", null, "Noir");
      expect(mockColorCreate).toHaveBeenCalled();
    });

    it("createSeasonQuick throws without pfsRef", async () => {
      await expect(createSeasonQuick({ fr: "PE 2026" })).rejects.toThrow(/Paris Fashion Shop/);
    });

    it("createSeasonQuick uppercases the ref", async () => {
      await createSeasonQuick({ fr: "PE 2026" }, "pe2026");
      expect(mockSeasonCreate).toHaveBeenCalledWith({ data: { name: "PE 2026", pfsRef: "PE2026" } });
    });

    it("createManufacturingCountryQuick throws without pfsCountryRef", async () => {
      await expect(createManufacturingCountryQuick({ fr: "Chine" }, "CN")).rejects.toThrow(/Paris Fashion Shop/);
    });

    it("createManufacturingCountryQuick succeeds with pfsCountryRef", async () => {
      await createManufacturingCountryQuick({ fr: "Chine" }, "CN", "CN");
      expect(mockCountryCreate).toHaveBeenCalled();
    });
  });
});
