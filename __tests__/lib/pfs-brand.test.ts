import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCachedPfsBrandSpy } = vi.hoisted(() => ({
  getCachedPfsBrandSpy: vi.fn(),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsBrand: getCachedPfsBrandSpy,
}));

import { requirePfsBrand, PfsBrandRequiredError } from "@/lib/pfs-brand";

describe("requirePfsBrand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the brand when one is selected", async () => {
    getCachedPfsBrandSpy.mockResolvedValue({ id: "BRAND-1", name: "Beli & Jolie" });

    const result = await requirePfsBrand();

    expect(result).toEqual({ id: "BRAND-1", name: "Beli & Jolie" });
  });

  it("throws PfsBrandRequiredError when no brand is selected", async () => {
    getCachedPfsBrandSpy.mockResolvedValue(null);

    await expect(requirePfsBrand()).rejects.toBeInstanceOf(PfsBrandRequiredError);
  });

  it("error message mentions the settings page", async () => {
    getCachedPfsBrandSpy.mockResolvedValue(null);

    await expect(requirePfsBrand()).rejects.toThrow(/Paramètres.*Marketplaces/);
  });
});
