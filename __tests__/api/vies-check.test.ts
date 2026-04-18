import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/vies-check/route";

function makeReq(vat?: string | null): NextRequest {
  const url = new URL("http://localhost/api/admin/vies-check");
  if (vat !== undefined && vat !== null) url.searchParams.set("vat", vat);
  return new NextRequest(url.toString());
}

function mockAdmin() {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "1", role: "ADMIN", status: "APPROVED" },
  } as never);
}

describe("GET /api/admin/vies-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeReq("BE0506978319"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as never);
    const res = await GET(makeReq("BE0506978319"));
    expect(res.status).toBe(401);
  });

  it("rejects missing vat param", async () => {
    mockAdmin();
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
  });

  it("rejects malformed vat (too short)", async () => {
    mockAdmin();
    const res = await GET(makeReq("BE"));
    expect(res.status).toBe(400);
  });

  it("rejects non-EU country code", async () => {
    mockAdmin();
    const res = await GET(makeReq("US123456789"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/US/);
  });

  it("accepts spaces/dots in input (normalizes)", async () => {
    mockAdmin();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ isValid: true, name: "ACME", address: "Rue X", requestDate: "2026-04-17T10:00:00Z" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeReq("BE 0506.978.319"));
    expect(res.status).toBe(200);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/ms/BE/vat/0506978319");
  });

  it("returns a valid result when VIES confirms", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            isValid: true,
            name: "ACME Corp",
            address: "Rue de la Loi 1, Bruxelles",
            requestDate: "2026-04-17T09:00:00Z",
          }),
          { status: 200 }
        )
      )
    );

    const res = await GET(makeReq("BE0506978319"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.countryCode).toBe("BE");
    expect(body.vatNumber).toBe("0506978319");
    expect(body.name).toBe("ACME Corp");
    expect(body.address).toContain("Bruxelles");
  });

  it("returns valid=false when VIES says invalid", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ isValid: false, name: "---", address: "---" }), { status: 200 })
      )
    );

    const res = await GET(makeReq("BE0000000000"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.name).toBeNull();
    expect(body.address).toBeNull();
  });

  it("surfaces userError from VIES", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ isValid: false, userError: "SERVICE_UNAVAILABLE" }), { status: 200 })
      )
    );

    const res = await GET(makeReq("BE0506978319"));
    const body = await res.json();

    expect(body.serviceError).toContain("SERVICE_UNAVAILABLE");
  });

  it("handles VIES non-200 gracefully (no 5xx leak)", async () => {
    mockAdmin();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 503 })));

    const res = await GET(makeReq("BE0506978319"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.serviceError).toMatch(/503/);
  });

  it("handles fetch network error gracefully", async () => {
    mockAdmin();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await GET(makeReq("BE0506978319"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.serviceError).toMatch(/VIES/);
  });

  it("handles abort/timeout gracefully", async () => {
    mockAdmin();
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));

    const res = await GET(makeReq("BE0506978319"));
    const body = await res.json();

    expect(body.serviceError).toMatch(/10 secondes/);
  });

  it("accepts XI (Northern Ireland) as a valid member state", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ isValid: true }), { status: 200 }))
    );

    const res = await GET(makeReq("XI123456789"));
    expect(res.status).toBe(200);
  });
});
