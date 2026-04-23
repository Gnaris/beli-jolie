import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchMock, getAnkorstoreHeadersSpy } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getAnkorstoreHeadersSpy: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
}));

vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/ankorstore-auth", () => ({
  getAnkorstoreHeaders: getAnkorstoreHeadersSpy,
  ANKORSTORE_BASE_URL: "https://api.ankorstore.test",
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ankorstorePushProducts } from "@/lib/ankorstore-api-write";

function okRes(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function errRes(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  };
}

const aProduct = {
  external_id: "REF-1",
  name: "Collier",
  description: "Desc",
  wholesale_price: 10,
  retail_price: 18,
  vat_rate: 20,
  variants: [
    {
      sku: "REF-1_N_1",
      external_id: "REF-1_N_1",
      stock_quantity: 5,
      wholesalePrice: 10,
      retailPrice: 18,
      originalWholesalePrice: 10,
      options: [{ name: "color" as const, value: "Noir" }],
    },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("ankorstorePushProducts", () => {
  it("calls create → add → start in order and returns the opId", async () => {
    fetchMock
      .mockResolvedValueOnce(okRes({ data: { id: "op-42" } })) // create
      .mockResolvedValueOnce(okRes({})) // add products
      .mockResolvedValueOnce(okRes({})); // start

    const res = await ankorstorePushProducts([aProduct], "update");

    expect(res).toEqual({ success: true, opId: "op-42" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe("https://api.ankorstore.test/catalog/integrations/operations");
    expect(createInit?.method).toBe("POST");
    const createBody = JSON.parse(createInit!.body as string);
    expect(createBody.data.attributes.operationType).toBe("update");
    expect(createBody.data.attributes.callbackUrl).toMatch(/\/api\/ankorstore\/callback\//);

    const [addUrl, addInit] = fetchMock.mock.calls[1];
    expect(addUrl).toBe("https://api.ankorstore.test/catalog/integrations/operations/op-42/products");
    expect(addInit?.method).toBe("POST");
    const addBody = JSON.parse(addInit!.body as string);
    expect(addBody.products).toHaveLength(1);
    expect(addBody.products[0].attributes.external_id).toBe("REF-1");

    const [startUrl, startInit] = fetchMock.mock.calls[2];
    expect(startUrl).toBe("https://api.ankorstore.test/catalog/integrations/operations/op-42");
    expect(startInit?.method).toBe("PATCH");
    const startBody = JSON.parse(startInit!.body as string);
    expect(startBody.data.attributes.status).toBe("started");
  });

  it("returns failure when create step fails", async () => {
    fetchMock.mockResolvedValueOnce(errRes(500, "server down"));

    const res = await ankorstorePushProducts([aProduct]);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to create operation/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns failure when add step fails", async () => {
    fetchMock
      .mockResolvedValueOnce(okRes({ data: { id: "op-1" } }))
      .mockResolvedValueOnce(errRes(422, "bad payload"));

    const res = await ankorstorePushProducts([aProduct]);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to add products/);
  });

  it("returns failure with no products", async () => {
    const res = await ankorstorePushProducts([]);
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches products in chunks of 50", async () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      ...aProduct,
      external_id: `REF-${i}`,
      variants: aProduct.variants.map((v) => ({ ...v, sku: `REF-${i}_V`, external_id: `REF-${i}_V` })),
    }));

    fetchMock
      .mockResolvedValueOnce(okRes({ data: { id: "op-1" } })) // create
      .mockResolvedValueOnce(okRes({})) // add batch 1 (50 products)
      .mockResolvedValueOnce(okRes({})) // add batch 2 (25 products)
      .mockResolvedValueOnce(okRes({})); // start

    const res = await ankorstorePushProducts(many);

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const batch1 = JSON.parse((fetchMock.mock.calls[1][1]!.body as string));
    const batch2 = JSON.parse((fetchMock.mock.calls[2][1]!.body as string));
    expect(batch1.products).toHaveLength(50);
    expect(batch2.products).toHaveLength(25);
  });
});
