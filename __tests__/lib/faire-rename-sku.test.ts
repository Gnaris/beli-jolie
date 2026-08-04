import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/faire-auth", () => ({
  FAIRE_BASE_URL: "https://www.faire.com/external-api/v2",
  getFaireHeaders: vi.fn(async () => ({
    "X-FAIRE-ACCESS-TOKEN": "test-key",
  })),
}));

import { faireRenameVariantSku } from "@/lib/faire-rename-sku";

describe("faireRenameVariantSku", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("PATCH le bon endpoint avec un body { sku }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await faireRenameVariantSku(
      "p_abc",
      "po_xyz",
      "1880_noir_UNIT_0r8sjxmy",
    );

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://www.faire.com/external-api/v2/products/p_abc/variants/po_xyz",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      sku: "1880_noir_UNIT_0r8sjxmy",
    });
  });

  it("renvoie success:false quand Faire refuse le rename (ex: 400 immutable)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: "sku is not editable" }),
          { status: 400 },
        ),
      ) as unknown as typeof fetch;

    const res = await faireRenameVariantSku("p_abc", "po_xyz", "new-sku");
    expect(res.success).toBe(false);
    expect(res.error).toBe("HTTP 400");
  });

  it("URL-encode les IDs (pas de fuite de caractères spéciaux)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await faireRenameVariantSku("p abc/x", "po$xyz", "sku");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("p%20abc%2Fx");
    expect(url).toContain("po%24xyz");
  });
});
