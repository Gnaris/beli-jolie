/**
 * Vérifie que `pfsListProducts` propage le paramètre `brand` à l'URL PFS quand
 * une marque est passée, et qu'on n'envoie rien quand brandId est null/undefined.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchSpy, getPfsHeadersSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  getPfsHeadersSpy: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
}));

vi.mock("@/lib/pfs-auth", () => ({
  getPfsHeaders: getPfsHeadersSpy,
  invalidatePfsToken: vi.fn(),
  PFS_BASE_URL: "https://wholesaler-api.parisfashionshops.com/api/v1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub global fetch
beforeEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error global fetch override for tests
  global.fetch = fetchSpy;
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, from: 0, per_page: 100, total: 0 } }),
  });
});

import { pfsListProducts, pfsListBrands } from "@/lib/pfs-api";

describe("pfsListProducts — filtre par marque", () => {
  it("ajoute &brand=<id> à l'URL quand brandId est fourni", async () => {
    await pfsListProducts(1, 100, "a01AZ00000314QgYAI");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("page=1");
    expect(url).toContain("per_page=100");
    expect(url).toContain("status=ACTIVE");
    expect(url).toContain("brand=a01AZ00000314QgYAI");
  });

  it("n'ajoute pas le paramètre brand quand brandId est omis", async () => {
    await pfsListProducts(1, 100);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain("brand=");
  });

  it("n'ajoute pas le paramètre brand quand brandId est null", async () => {
    await pfsListProducts(1, 100, null);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain("brand=");
  });
});

describe("pfsListBrands", () => {
  it("appelle GET /account/listBrands et renvoie data[]", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [
            { id: "BRAND-1", name: "Beli & Jolie", logo_url: "logo.png", genders: ["WOMAN"] },
            { id: "BRAND-2", name: "Princesse", logo_url: null, genders: ["WOMAN"] },
          ],
        }),
    });

    const brands = await pfsListBrands();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/account/listBrands");
    expect(brands).toHaveLength(2);
    expect(brands[0].id).toBe("BRAND-1");
    expect(brands[1].name).toBe("Princesse");
  });

  it("retourne un tableau vide si la réponse n'a pas de data", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false }),
    });

    const brands = await pfsListBrands();
    expect(brands).toEqual([]);
  });
});
