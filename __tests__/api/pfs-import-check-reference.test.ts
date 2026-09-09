import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: vi.fn() }));
vi.mock("@/lib/pfs-import", () => ({ pickDefaultImage: () => null }));
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { pfsCheckReference } from "@/lib/pfs-api";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/pfs-import/check-reference/route";

function makeReq(body: unknown): Request {
  return new Request("http://x/api/admin/pfs-import/check-reference", {
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
  (prisma.product.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("POST /api/admin/pfs-import/check-reference", () => {
  it("refuse si PFS matche par préfixe et renvoie une autre référence", async () => {
    // Bug PFS observé : /checkReference/13369ROBE renvoie le produit "13369"
    // (match partiel). Sans garde, on importerait le mauvais produit.
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      product: {
        id: "pro_WRONG",
        reference: "13369",
        label: { fr: "Autre produit" },
        images: {},
      },
    });

    const res = await POST(makeReq({ reference: "13369ROBE" }));
    const json = await res.json();

    expect(json.valid).toBe(false);
    expect(json.error).toContain("13369ROBE");
    expect(json.error).toContain("13369");
  });

  it("accepte si PFS renvoie exactement la même référence", async () => {
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      product: {
        id: "pro_OK",
        reference: "13369ROBE",
        label: { fr: "Robe test" },
        images: {},
      },
    });

    const res = await POST(makeReq({ reference: "13369ROBE" }));
    const json = await res.json();

    expect(json.valid).toBe(true);
    expect(json.product.pfsId).toBe("pro_OK");
    expect(json.product.reference).toBe("13369ROBE");
  });

  it("accepte si PFS renvoie la même référence en casse différente", async () => {
    (pfsCheckReference as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      exists: true,
      product: {
        id: "pro_OK",
        reference: "13369robe",
        label: { fr: "Robe test" },
        images: {},
      },
    });

    const res = await POST(makeReq({ reference: "13369ROBE" }));
    const json = await res.json();

    expect(json.valid).toBe(true);
    expect(json.product.pfsId).toBe("pro_OK");
  });
});
