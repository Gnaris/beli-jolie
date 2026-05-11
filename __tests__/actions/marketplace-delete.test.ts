import { describe, it, expect, vi, beforeEach } from "vitest";

const { pfsDeleteProductSpy, ankorstoreDeleteProductSpy } = vi.hoisted(() => ({
  pfsDeleteProductSpy: vi.fn(),
  ankorstoreDeleteProductSpy: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/pfs-api-write", () => ({ pfsDeleteProduct: pfsDeleteProductSpy }));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreDeleteProduct: ankorstoreDeleteProductSpy,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  deleteProductsOnPfs,
  deleteProductsOnAnkorstore,
} from "@/app/actions/admin/marketplace-delete";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteProductsOnPfs", () => {
  it("returns ok for each successful deletion", async () => {
    pfsDeleteProductSpy.mockResolvedValue(undefined);

    const results = await deleteProductsOnPfs([
      { pfsProductId: "pfs-1", reference: "REF-1" },
      { pfsProductId: "pfs-2", reference: "REF-2" },
    ]);

    expect(pfsDeleteProductSpy).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { pfsProductId: "pfs-1", reference: "REF-1", status: "ok" },
      { pfsProductId: "pfs-2", reference: "REF-2", status: "ok" },
    ]);
  });

  it("captures errors per-item without throwing the whole batch", async () => {
    pfsDeleteProductSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("PFS down"));

    const results = await deleteProductsOnPfs([
      { pfsProductId: "pfs-1", reference: "REF-1" },
      { pfsProductId: "pfs-2", reference: "REF-2" },
    ]);

    expect(results).toEqual([
      { pfsProductId: "pfs-1", reference: "REF-1", status: "ok" },
      {
        pfsProductId: "pfs-2",
        reference: "REF-2",
        status: "error",
        message: "PFS down",
      },
    ]);
  });

  it("returns an empty array when no items are passed", async () => {
    const results = await deleteProductsOnPfs([]);
    expect(results).toEqual([]);
    expect(pfsDeleteProductSpy).not.toHaveBeenCalled();
  });
});

describe("deleteProductsOnAnkorstore", () => {
  it("returns ok for each successful deletion", async () => {
    ankorstoreDeleteProductSpy.mockResolvedValue(undefined);

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
      { ankorsProductId: "ank-2", reference: "REF-2" },
    ]);

    expect(ankorstoreDeleteProductSpy).toHaveBeenCalledTimes(2);
    expect(ankorstoreDeleteProductSpy).toHaveBeenNthCalledWith(1, "ank-1");
    expect(ankorstoreDeleteProductSpy).toHaveBeenNthCalledWith(2, "ank-2");
    expect(results).toEqual([
      { ankorsProductId: "ank-1", reference: "REF-1", status: "ok" },
      { ankorsProductId: "ank-2", reference: "REF-2", status: "ok" },
    ]);
  });

  it("captures errors per-item without throwing the whole batch", async () => {
    ankorstoreDeleteProductSpy
      .mockRejectedValueOnce(new Error("Ankorstore 500"))
      .mockResolvedValueOnce(undefined);

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
      { ankorsProductId: "ank-2", reference: "REF-2" },
    ]);

    expect(results).toEqual([
      {
        ankorsProductId: "ank-1",
        reference: "REF-1",
        status: "error",
        message: "Ankorstore 500",
      },
      { ankorsProductId: "ank-2", reference: "REF-2", status: "ok" },
    ]);
  });

  it("returns an empty array when no items are passed", async () => {
    const results = await deleteProductsOnAnkorstore([]);
    expect(results).toEqual([]);
    expect(ankorstoreDeleteProductSpy).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("throws when user is not admin", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    });
    await expect(
      deleteProductsOnAnkorstore([
        { ankorsProductId: "ank-1", reference: "REF-1" },
      ]),
    ).rejects.toThrow("Accès non autorisé");
    expect(ankorstoreDeleteProductSpy).not.toHaveBeenCalled();
  });
});
