import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { visit: { upsert: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { POST } from "@/app/api/track-visit/route";

function makeReq(cookieHeader?: string) {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest("http://test/api/track-visit", {
    method: "POST",
    headers,
  });
}

describe("POST /api/track-visit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.visit.upsert).mockResolvedValue({} as never);
  });

  it("upsert avec userId préfixé pour un visiteur connecté", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as never);
    await POST(makeReq());

    const arg = vi.mocked(prisma.visit.upsert).mock.calls[0][0] as {
      where:  { visitorId_date: { visitorId: string; date: string } };
      create: { visitorId: string; date: string; isAuthenticated: boolean };
    };
    expect(arg.where.visitorId_date.visitorId).toBe("u:user-1");
    expect(arg.create.isAuthenticated).toBe(true);
    expect(arg.create.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("crée un cookie anonyme si absent + marque isAuthenticated=false", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await POST(makeReq());

    const arg = vi.mocked(prisma.visit.upsert).mock.calls[0][0] as {
      create: { visitorId: string; isAuthenticated: boolean };
    };
    expect(arg.create.isAuthenticated).toBe(false);
    expect(arg.create.visitorId.startsWith("a:")).toBe(true);

    // Le cookie bj_visitor_id doit être posé sur la réponse
    const setCookie = (res as unknown as Response).headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/bj_visitor_id=/);
  });

  it("réutilise le cookie existant pour un visiteur anonyme", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    await POST(makeReq("bj_visitor_id=ABC12345existing"));

    const arg = vi.mocked(prisma.visit.upsert).mock.calls[0][0] as {
      where: { visitorId_date: { visitorId: string } };
    };
    expect(arg.where.visitorId_date.visitorId).toBe("ABC12345existing");
  });

  it("ne plante pas si la BDD échoue (retourne ok:false silencieusement)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    vi.mocked(prisma.visit.upsert).mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq());
    const body = await (res as unknown as Response).json();
    expect(body.ok).toBe(false);
  });
});
