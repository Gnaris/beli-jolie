/**
 * Vérifie que le filtre `easy_express_excluded_carriers` masque bien les
 * transporteurs choisis par l'admin dans /api/carriers (branche Easy-Express).
 * Les transporteurs Smarty365 ne sont PAS impactés — ce filtre est spécifique
 * à Easy-Express.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/carrier-signature", () => ({
  signCarrier: vi.fn().mockReturnValue("sig-fake"),
}));
vi.mock("@/lib/easy-express", () => ({
  fetchEasyExpressRates: vi.fn(),
  splitWeightIntoParcels: vi.fn().mockReturnValue([{ weight: 1 }]),
}));
vi.mock("@/lib/smarty365", () => ({
  smarty365Rates: vi.fn(),
}));

const mockExcluded = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/cached-data", () => ({
  getCachedEasyExpressApiKey: vi.fn().mockResolvedValue("dummy-key"),
  getCachedSmarty365ApiKey: vi.fn().mockResolvedValue(null),
  getCachedActiveShippingProvider: vi.fn().mockResolvedValue("easy_express"),
  getCachedShippingMargin: vi.fn().mockResolvedValue({ type: "fixed", value: 0 }),
  getCachedSmarty365InsuranceRatePct: vi.fn().mockResolvedValue(0.6),
  getCachedEasyExpressExcludedCarriers: vi.fn().mockImplementation(async () => mockExcluded.list),
}));

import { getServerSession } from "next-auth";
import { fetchEasyExpressRates } from "@/lib/easy-express";
import { POST } from "@/app/api/carriers/route";

function makeReq(body: unknown) {
  return new NextRequest("http://test/api/carriers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeCarriers() {
  return {
    success: true as const,
    transactionId: "tx-1",
    carriers: [
      { carrierId: "cid-chrono", name: "Chronopost", price: 10, delay: "24h", logo: "/l/c.png" },
      { carrierId: "cid-coli",   name: "Colissimo",  price:  8, delay: "48h", logo: "/l/co.png" },
      { carrierId: "cid-gls",    name: "GLS",         price:  9, delay: "48h", logo: "/l/g.png" },
      { carrierId: "cid-mr",     name: "Mondial Relay", price: 6, delay: "4j", logo: "/l/mr.png" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExcluded.list = [];
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(fetchEasyExpressRates).mockResolvedValue(fakeCarriers());
});

describe("/api/carriers — filtre Easy-Express exclus", () => {
  it("renvoie TOUS les transporteurs quand la liste exclue est vide", async () => {
    mockExcluded.list = [];
    const res = await POST(makeReq({ zipCode: "75001", country: "FR", weightKg: 2 }));
    const data = (await (res as unknown as Response).json()) as {
      carriers: { name: string }[];
    };
    expect(data.carriers.map((c) => c.name)).toEqual([
      "Chronopost",
      "Colissimo",
      "GLS",
      "Mondial Relay",
    ]);
  });

  it("masque les transporteurs présents dans la liste exclue", async () => {
    mockExcluded.list = ["Mondial Relay", "GLS"];
    const res = await POST(makeReq({ zipCode: "75001", country: "FR", weightKg: 2 }));
    const data = (await (res as unknown as Response).json()) as {
      carriers: { name: string }[];
    };
    expect(data.carriers.map((c) => c.name)).toEqual(["Chronopost", "Colissimo"]);
  });

  it("compare le nom insensiblement à la casse et aux espaces", async () => {
    mockExcluded.list = ["  mondial relay  ", "CHRONOPOST"];
    const res = await POST(makeReq({ zipCode: "75001", country: "FR", weightKg: 2 }));
    const data = (await (res as unknown as Response).json()) as {
      carriers: { name: string }[];
    };
    expect(data.carriers.map((c) => c.name)).toEqual(["Colissimo", "GLS"]);
  });

  it("renvoie noCarrierConfigured si tous les transporteurs sont exclus", async () => {
    mockExcluded.list = ["Chronopost", "Colissimo", "GLS", "Mondial Relay"];
    const res = await POST(makeReq({ zipCode: "75001", country: "FR", weightKg: 2 }));
    const data = (await (res as unknown as Response).json()) as {
      carriers: unknown[];
      noCarrierConfigured?: boolean;
    };
    expect(data.carriers).toHaveLength(0);
    expect(data.noCarrierConfigured).toBe(true);
  });

  it("n'impacte pas la branche Smarty365 (filtre spécifique à Easy-Express)", async () => {
    const { getCachedActiveShippingProvider } = await import("@/lib/cached-data");
    vi.mocked(getCachedActiveShippingProvider).mockResolvedValueOnce("smarty365");
    const { getCachedSmarty365ApiKey } = await import("@/lib/cached-data");
    vi.mocked(getCachedSmarty365ApiKey).mockResolvedValueOnce("smarty-key");
    const { smarty365Rates } = await import("@/lib/smarty365");
    vi.mocked(smarty365Rates).mockResolvedValueOnce({
      success: true,
      transactionId: "",
      carriers: [
        { carrierId: "smarty:CHRONOPOST:X", name: "Chronopost", price: 10, delay: "24h", logo: "" },
      ],
    } as never);

    // On exclut Chronopost dans la config Easy-Express — doit être ignoré car
    // on est en Smarty365.
    mockExcluded.list = ["Chronopost"];

    const res = await POST(makeReq({ zipCode: "75001", country: "FR", weightKg: 2 }));
    const data = (await (res as unknown as Response).json()) as {
      carriers: { name: string }[];
    };
    expect(data.carriers.map((c) => c.name)).toEqual(["Chronopost"]);
  });
});
