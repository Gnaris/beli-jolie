import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importJob: { create: vi.fn() },
  },
}));
vi.mock("@/lib/pfs-import-processor", () => ({
  processPfsImport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { processPfsImport } from "@/lib/pfs-import-processor";
import { POST } from "@/app/api/admin/pfs-import/start-job/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://x/api/admin/pfs-import/start-job", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    pfsId: `id-${i}`,
    reference: `REF-${i}`,
    name: `Produit ${i}`,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  });
  (prisma.importJob.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "job-1" });
});

describe("POST /api/admin/pfs-import/start-job — plafond produits", () => {
  it("accepte exactement 1000 produits", async () => {
    const res = await POST(makeReq({ items: makeItems(1000) }));
    expect(res.status).toBe(200);
    expect(prisma.importJob.create).toHaveBeenCalledOnce();
    expect(processPfsImport).toHaveBeenCalledWith("job-1");
  });

  it("refuse 1001 produits avec un message qui mentionne la limite 1000", async () => {
    const res = await POST(makeReq({ items: makeItems(1001) }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("1000");
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  it("refuse une sélection vide", async () => {
    const res = await POST(makeReq({ items: [] }));
    expect(res.status).toBe(400);
  });

  it("refuse les non-admins", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "client-1", role: "CLIENT" },
    });
    const res = await POST(makeReq({ items: makeItems(10) }));
    expect(res.status).toBe(401);
  });
});
