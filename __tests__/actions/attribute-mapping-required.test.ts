import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCategoryCreate = vi.fn();
const mockColorCreate = vi.fn();
const mockSeasonCreate = vi.fn();
const mockCountryCreate = vi.fn();
const mockCountryFindFirst = vi.fn();

const mockCategoryTranslationUpsert = vi.fn();
const mockColorTranslationUpsert = vi.fn();
const mockSeasonTranslationUpsert = vi.fn();
const mockCountryTranslationUpsert = vi.fn();

const mockCategoryFindFirst = vi.fn();
const mockCategoryUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      create: (...a: unknown[]) => mockCategoryCreate(...a),
      findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a),
      update: (...a: unknown[]) => mockCategoryUpdate(...a),
    },
    color: { create: (...a: unknown[]) => mockColorCreate(...a) },
    season: { create: (...a: unknown[]) => mockSeasonCreate(...a) },
    manufacturingCountry: {
      create: (...a: unknown[]) => mockCountryCreate(...a),
      findFirst: (...a: unknown[]) => mockCountryFindFirst(...a),
    },
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
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateSubCategory: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateSeason: vi.fn(),
  autoTranslateManufacturingCountry: vi.fn(),
}));

import { createCategory } from "@/app/actions/admin/categories";
import { createSeason } from "@/app/actions/admin/seasons";
import { createManufacturingCountry } from "@/app/actions/admin/manufacturing-countries";
import {
  createCategoryQuick,
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
    mockCountryFindFirst.mockResolvedValue(null);
    mockCategoryFindFirst.mockResolvedValue(null);
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

    it("createManufacturingCountryQuick throws when ISO is missing", async () => {
      await expect(createManufacturingCountryQuick({ fr: "Chine" }, null, "CN")).rejects.toThrow(/ISO/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("createManufacturingCountryQuick throws when ISO is malformed", async () => {
      await expect(createManufacturingCountryQuick({ fr: "Chine" }, "FRA", "CN")).rejects.toThrow(/2 lettres/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("createManufacturingCountryQuick throws when ISO is already used", async () => {
      mockCountryFindFirst.mockResolvedValueOnce({ name: "France" });
      await expect(createManufacturingCountryQuick({ fr: "Nouveau pays" }, "FR", "NP")).rejects.toThrow(/déjà utilisé/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("createManufacturingCountryQuick uppercases the ISO code", async () => {
      await createManufacturingCountryQuick({ fr: "Chine" }, "cn", "CN");
      expect(mockCountryCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ isoCode: "CN" }),
      }));
    });
  });

  // ── createManufacturingCountry form action: ISO required ──
  describe("createManufacturingCountry — ISO validation", () => {
    it("throws when ISO is missing", async () => {
      await expect(
        createManufacturingCountry(fd({ name: "Chine", pfsCountryRef: "CN" }))
      ).rejects.toThrow(/ISO/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("throws when ISO is malformed", async () => {
      await expect(
        createManufacturingCountry(fd({ name: "Chine", isoCode: "CHN", pfsCountryRef: "CN" }))
      ).rejects.toThrow(/2 lettres/);
      expect(mockCountryCreate).not.toHaveBeenCalled();
    });

    it("normalizes ISO to uppercase before saving", async () => {
      await createManufacturingCountry(fd({ name: "France", isoCode: "fr", pfsCountryRef: "FR" }));
      expect(mockCountryCreate).toHaveBeenCalledWith({
        data: { name: "France", isoCode: "FR", pfsCountryRef: "FR" },
      });
    });
  });
});
