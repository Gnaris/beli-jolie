import { describe, it, expect, vi, beforeEach } from "vitest";

const loadExportProducts = vi.fn();
const loadExportContext = vi.fn();
const validateProductsForMarketplace = vi.fn();
const generatePfsExcelFiles = vi.fn();
const generateEfashionExcelFiles = vi.fn();
const generateMicrostoreExcelFiles = vi.fn();
const generateAnkorstoreExcelFiles = vi.fn();
const enrichProductsWithPfsTranslations = vi.fn();
const prepareImagesForPfs = vi.fn();
const prepareImagesForEfashion = vi.fn();
const prepareImagesForMicrostore = vi.fn();

vi.mock("@/lib/marketplace-excel/load-products", () => ({
  loadExportProducts: (...a: unknown[]) => loadExportProducts(...a),
  loadExportContext: (...a: unknown[]) => loadExportContext(...a),
}));
vi.mock("@/lib/marketplace-excel/validate", () => ({
  validateProductsForMarketplace: (...a: unknown[]) => validateProductsForMarketplace(...a),
}));
vi.mock("@/lib/marketplace-excel/generate-pfs", () => ({
  generatePfsExcelFiles: (...a: unknown[]) => generatePfsExcelFiles(...a),
}));
vi.mock("@/lib/marketplace-excel/generate-efashion", () => ({
  generateEfashionExcelFiles: (...a: unknown[]) => generateEfashionExcelFiles(...a),
}));
vi.mock("@/lib/marketplace-excel/generate-microstore", () => ({
  generateMicrostoreExcelFiles: (...a: unknown[]) => generateMicrostoreExcelFiles(...a),
}));
vi.mock("@/lib/marketplace-excel/generate-ankorstore", () => ({
  generateAnkorstoreExcelFiles: (...a: unknown[]) => generateAnkorstoreExcelFiles(...a),
}));
vi.mock("@/lib/marketplace-excel/enrich-translations-pfs", () => ({
  enrichProductsWithPfsTranslations: (...a: unknown[]) => enrichProductsWithPfsTranslations(...a),
}));
vi.mock("@/lib/marketplace-excel/prepare-images", () => ({
  prepareImagesForPfs: (...a: unknown[]) => prepareImagesForPfs(...a),
  prepareImagesForEfashion: (...a: unknown[]) => prepareImagesForEfashion(...a),
  prepareImagesForMicrostore: (...a: unknown[]) => prepareImagesForMicrostore(...a),
}));

import { runMarketplaceExport } from "@/lib/marketplace-excel/export-orchestrator";

const FAKE_PRODUCT = { id: "p1", reference: "REF-1" };
const FAKE_EXCEL = { filename: "x.xlsx", buffer: Buffer.from("xlsx") };
const FAKE_IMAGE = {
  filename: "REF-1 Or 1.JPG",
  buffer: Buffer.from("img"),
  productId: "p1",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadExportProducts.mockResolvedValue([FAKE_PRODUCT]);
  loadExportContext.mockResolvedValue({ shopName: "BJ", markups: {}, publicBaseUrl: "" });
  validateProductsForMarketplace.mockReturnValue([
    { productId: "p1", reference: "REF-1", eligible: true, missing: [] },
  ]);
  generatePfsExcelFiles.mockResolvedValue([FAKE_EXCEL]);
  generateEfashionExcelFiles.mockResolvedValue([FAKE_EXCEL]);
  generateMicrostoreExcelFiles.mockResolvedValue([FAKE_EXCEL]);
  generateAnkorstoreExcelFiles.mockResolvedValue([FAKE_EXCEL]);
  enrichProductsWithPfsTranslations.mockImplementation(async (p: unknown[]) => p);
  prepareImagesForPfs.mockResolvedValue([FAKE_IMAGE]);
  prepareImagesForEfashion.mockResolvedValue([FAKE_IMAGE]);
  prepareImagesForMicrostore.mockResolvedValue([FAKE_IMAGE]);
});

describe("runMarketplaceExport — mode excel-only", () => {
  it("efashion : ne prépare pas les images, sort un .xlsx direct", async () => {
    const out = await runMarketplaceExport("efashion", ["p1"], "excel-only");
    expect(generateEfashionExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForEfashion).not.toHaveBeenCalled();
    expect(out.outputType).toBe("xlsx");
    expect(out.filename).toMatch(/\.xlsx$/);
  });

  it("microstore : ne prépare pas les images, sort un .xlsx direct", async () => {
    const out = await runMarketplaceExport("microstore", ["p1"], "excel-only");
    expect(generateMicrostoreExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForMicrostore).not.toHaveBeenCalled();
    expect(out.outputType).toBe("xlsx");
  });

  it("pfs : ne prépare pas les images, sort un .zip avec uniquement l'Excel", async () => {
    const out = await runMarketplaceExport("pfs", ["p1"], "excel-only");
    expect(generatePfsExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForPfs).not.toHaveBeenCalled();
    expect(out.outputType).toBe("zip");
    expect(out.filename).toMatch(/_excel_/);
  });
});

describe("runMarketplaceExport — mode images-only", () => {
  it("efashion : ne génère pas l'Excel, sort un .zip d'images", async () => {
    const out = await runMarketplaceExport("efashion", ["p1"], "images-only");
    expect(generateEfashionExcelFiles).not.toHaveBeenCalled();
    expect(prepareImagesForEfashion).toHaveBeenCalledOnce();
    expect(out.outputType).toBe("zip");
    expect(out.filename).toMatch(/_images_/);
  });

  it("microstore : ne génère pas l'Excel, sort un .zip d'images", async () => {
    const out = await runMarketplaceExport("microstore", ["p1"], "images-only");
    expect(generateMicrostoreExcelFiles).not.toHaveBeenCalled();
    expect(prepareImagesForMicrostore).toHaveBeenCalledOnce();
    expect(out.outputType).toBe("zip");
  });

  it("pfs : ne génère pas l'Excel ni les traductions, sort un .zip d'images", async () => {
    const out = await runMarketplaceExport("pfs", ["p1"], "images-only");
    expect(generatePfsExcelFiles).not.toHaveBeenCalled();
    expect(enrichProductsWithPfsTranslations).not.toHaveBeenCalled();
    expect(prepareImagesForPfs).toHaveBeenCalledOnce();
    expect(out.outputType).toBe("zip");
    expect(out.filename).toMatch(/_images_/);
  });

  it("ankorstore : refusé (les images sont récupérées par URL)", async () => {
    await expect(
      runMarketplaceExport("ankorstore", ["p1"], "images-only"),
    ).rejects.toThrow(/Ankorstore/);
  });
});

describe("runMarketplaceExport — mode both (défaut)", () => {
  it("efashion : génère Excel + prépare images, sort un .zip", async () => {
    const out = await runMarketplaceExport("efashion", ["p1"]);
    expect(generateEfashionExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForEfashion).toHaveBeenCalledOnce();
    expect(out.outputType).toBe("zip");
    expect(out.filename).not.toMatch(/_excel_|_images_/);
  });

  it("pfs : enrichit traductions + génère Excel + prépare images", async () => {
    const out = await runMarketplaceExport("pfs", ["p1"], "both");
    expect(enrichProductsWithPfsTranslations).toHaveBeenCalledOnce();
    expect(generatePfsExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForPfs).toHaveBeenCalledOnce();
    expect(out.outputType).toBe("zip");
  });

  it("ankorstore : Excel direct, jamais d'images bundlées", async () => {
    const out = await runMarketplaceExport("ankorstore", ["p1"], "both");
    expect(generateAnkorstoreExcelFiles).toHaveBeenCalledOnce();
    expect(prepareImagesForEfashion).not.toHaveBeenCalled();
    expect(prepareImagesForMicrostore).not.toHaveBeenCalled();
    expect(prepareImagesForPfs).not.toHaveBeenCalled();
    expect(out.outputType).toBe("xlsx");
  });
});
