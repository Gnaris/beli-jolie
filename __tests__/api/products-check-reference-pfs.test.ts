import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/cached-data", () => ({
  getCachedHasPfsConfig: vi.fn(),
}));
vi.mock("@/lib/pfs-api", () => ({
  pfsCheckReference: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { getCachedHasPfsConfig } from "@/lib/cached-data";
import { pfsCheckReference } from "@/lib/pfs-api";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/products/check-reference-pfs/route";

function makeReq(body: unknown): Request {
  return new Request("http://x/api/admin/products/check-reference-pfs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { role: "ADMIN" },
  });
});

describe("POST /api/admin/products/check-reference-pfs", () => {
  it("renvoie 401 si non admin", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { role: "CLIENT" },
    });
    const res = await POST(makeReq({ reference: "ABC" }));
    expect(res.status).toBe(401);
  });

  it("renvoie status=ok si reference vide", async () => {
    const res = await POST(makeReq({ reference: "  " }));
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("renvoie status=not_configured si PFS n'est pas configuré", async () => {
    (getCachedHasPfsConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeReq({ reference: "ABC" }));
    const json = await res.json();
    expect(json).toEqual({ status: "not_configured" });
    expect(pfsCheckReference).not.toHaveBeenCalled();
  });

  it("renvoie status=ok si PFS dit que la ref n'existe pas", async () => {
    (getCachedHasPfsConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: false,
    });
    const res = await POST(makeReq({ reference: "ABC" }));
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  it("renvoie status=exists si PFS dit que la ref est prise par un autre produit", async () => {
    (getCachedHasPfsConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      product: { id: "pro_OTHER", reference: "ABC", label: { fr: "Autre" } },
    });
    const res = await POST(makeReq({ reference: "abc" }));
    const json = await res.json();
    expect(json.status).toBe("exists");
    expect(json.message).toContain("déjà");
  });

  it("renvoie status=ok si la ref appartient au produit en cours d'édition", async () => {
    (getCachedHasPfsConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      product: { id: "pro_MINE", reference: "ABC" },
    });
    (prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      pfsProductId: "pro_MINE",
    });
    const res = await POST(makeReq({ reference: "ABC", currentProductId: "prd_local" }));
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  it("renvoie status=error et HTTP 200 si pfsCheckReference jette", async () => {
    (getCachedHasPfsConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
    const res = await POST(makeReq({ reference: "ABC" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("error");
  });
});
