import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth-helpers";
import { setSiteConfig } from "@/lib/site-config-write";
import { updatePfsImportPriceMarkup } from "@/app/actions/admin/pfs-import-markup";

const requireAdminMock = requireAdmin as unknown as ReturnType<typeof vi.fn>;
const setSiteConfigMock = setSiteConfig as unknown as ReturnType<typeof vi.fn>;

describe("updatePfsImportPriceMarkup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue(undefined);
    setSiteConfigMock.mockResolvedValue(undefined);
  });

  it("écrit les 3 clés SiteConfig en cas de succès", async () => {
    const res = await updatePfsImportPriceMarkup({
      type: "percent",
      value: -20,
      rounding: "down",
    });
    expect(res).toEqual({ success: true });
    expect(setSiteConfigMock).toHaveBeenCalledWith("pfs_import_price_markup_type", "percent");
    expect(setSiteConfigMock).toHaveBeenCalledWith("pfs_import_price_markup_value", "-20");
    expect(setSiteConfigMock).toHaveBeenCalledWith("pfs_import_price_markup_rounding", "down");
  });

  it("accepte les valeurs négatives (baisse de prix)", async () => {
    const res = await updatePfsImportPriceMarkup({
      type: "percent",
      value: -50,
      rounding: "none",
    });
    expect(res.success).toBe(true);
  });

  it("rejette NaN via Zod", async () => {
    const res = await updatePfsImportPriceMarkup({
      type: "percent",
      value: Number.NaN,
      rounding: "none",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("rejette un type inconnu via Zod", async () => {
    const res = await updatePfsImportPriceMarkup({
      // @ts-expect-error volontaire — on teste la validation runtime
      type: "invalid",
      value: 0,
      rounding: "none",
    });
    expect(res.success).toBe(false);
  });
});
