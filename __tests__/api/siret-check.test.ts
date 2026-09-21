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
import { GET } from "@/app/api/admin/siret-check/route";

function makeReq(siret?: string | null): NextRequest {
  const url = new URL("http://localhost/api/admin/siret-check");
  if (siret !== undefined && siret !== null) url.searchParams.set("siret", siret);
  return new NextRequest(url.toString());
}

function mockAdmin() {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "1", role: "ADMIN", status: "APPROVED" },
  } as never);
}

describe("GET /api/admin/siret-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("refuse un non-authentifié", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeReq("12345678900012"));
    expect(res.status).toBe(401);
  });

  it("refuse un non-admin", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "1", role: "CLIENT", status: "APPROVED" },
    } as never);
    const res = await GET(makeReq("12345678900012"));
    expect(res.status).toBe(401);
  });

  it("refuse un paramètre siret manquant", async () => {
    mockAdmin();
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
  });

  it("refuse un SIRET trop court", async () => {
    mockAdmin();
    const res = await GET(makeReq("12345"));
    expect(res.status).toBe(400);
  });

  it("refuse un SIRET avec lettres", async () => {
    mockAdmin();
    const res = await GET(makeReq("1234567890001A"));
    expect(res.status).toBe(400);
  });

  it("accepte un SIRET avec espaces (normalise à 14 chiffres)", async () => {
    mockAdmin();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(makeReq("123 456 789 00012"));
    expect(res.status).toBe(200);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("q=12345678900012");
  });

  it("renvoie found=true avec les infos entreprise quand INSEE trouve", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                siren: "123456789",
                nom_complet: "ACME SAS",
                nom_raison_sociale: "ACME SAS",
                libelle_activite_principale: "Commerce de bijouterie",
                date_creation: "2010-05-12",
                etat_administratif: "A",
                siege: {
                  siret: "12345678900012",
                  adresse: "12 rue de la Paix 75002 PARIS",
                  etat_administratif: "A",
                },
                matching_etablissements: [
                  {
                    siret: "12345678900012",
                    adresse: "12 rue de la Paix 75002 PARIS",
                    etat_administratif: "A",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET(makeReq("12345678900012"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.companyName).toBe("ACME SAS");
    expect(body.address).toContain("PARIS");
    expect(body.activity).toContain("bijouterie");
    expect(body.activeStatus).toBe("active");
    expect(body.creationDate).toBe("2010-05-12");
  });

  it("détecte un établissement fermé", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                nom_complet: "ANCIENNE SARL",
                etat_administratif: "C",
                siege: { siret: "98765432100019", adresse: "1 rue X", etat_administratif: "C" },
                matching_etablissements: [
                  { siret: "98765432100019", adresse: "1 rue X", etat_administratif: "C" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET(makeReq("98765432100019"));
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.activeStatus).toBe("closed");
  });

  it("renvoie found=false quand aucun résultat INSEE", async () => {
    mockAdmin();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      ),
    );

    const res = await GET(makeReq("00000000000000"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
    expect(body.serviceError).toBeUndefined();
  });

  it("remonte un serviceError si INSEE répond non-200", async () => {
    mockAdmin();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 503 })));

    const res = await GET(makeReq("12345678900012"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
    expect(body.serviceError).toMatch(/503/);
  });

  it("remonte un serviceError sur erreur réseau", async () => {
    mockAdmin();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await GET(makeReq("12345678900012"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(false);
    expect(body.serviceError).toMatch(/INSEE/);
  });
});
