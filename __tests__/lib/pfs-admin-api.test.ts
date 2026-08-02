/**
 * Tests du module lib/pfs-admin-api.ts
 *
 * Objectifs :
 *  1. Auth : login → cache token, réutilisation avant TTL, retry après 401.
 *  2. Auth : credentials manquants ou Status != SUCCEEDED → erreur claire.
 *  3. pfsAdminFetchMaterialComposition :
 *     - produit sans compo → []
 *     - produit avec compo + dictionnaire OK → labels FR/EN enrichis
 *     - produit avec compo mais dictionnaire échoue → codes bruts, labels vides
 *     - slots vides intercalés → filtrés proprement
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsCredentials: vi.fn(async () => ({
    email: "issyma@example.com",
    password: "fake-pw",
  })),
}));

vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: () => "tenant-issyma",
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import APRÈS les mocks pour que les caches internes soient rebindés.
import {
  pfsAdminFetchMaterialComposition,
  invalidatePfsAdminToken,
  _resetPfsAdminCachesForTests,
} from "@/lib/pfs-admin-api";

interface StubResponse {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

function stubFetch(sequence: Array<StubResponse | ((input: string, init?: RequestInit) => StubResponse)>) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const rawBody = init?.body;
    let parsedBody: unknown = null;
    if (typeof rawBody === "string") {
      try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }
    }
    calls.push({ url, body: parsedBody, headers: (init?.headers as Record<string, string>) ?? {} });
    const entry = sequence.shift();
    if (!entry) throw new Error(`fetch unexpected call: ${url}`);
    const resp = typeof entry === "function" ? entry(url, init) : entry;
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: resp.json ?? (async () => ({})),
      text: resp.text ?? (async () => ""),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

function loginSuccessResponse(token = "fake-bearer-token"): StubResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      Response: {
        Status: "SUCCEEDED",
        Code: 0,
        Message: { Id: 1, Uid: "u", Token: token, Name: "N", Email: "e", Status: "ACTIVE" },
      },
    }),
  };
}

function productResponse(overrides: Record<string, unknown>): StubResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      Response: {
        Status: "SUCCEEDED",
        Code: 0,
        Message: {
          Id: "pro_test",
          CategoryId__c: "a045J00000BO0vRQAT",
          ...overrides,
        },
      },
    }),
  };
}

function compositionsDictResponse(entries: Array<Record<string, unknown>>): StubResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({ Response: { Status: "SUCCEEDED", Code: 0, Message: entries } }),
  };
}

beforeEach(async () => {
  _resetPfsAdminCachesForTests();
  await invalidatePfsAdminToken();
  vi.clearAllMocks();
});

describe("pfsAdminFetchMaterialComposition", () => {
  it("renvoie [] quand le produit n'a aucun slot compo rempli", async () => {
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: null,
        Composition_2__c: null,
        Composition_3__c: null,
        Composition_4__c: null,
        Composition_5__c: null,
      }),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toEqual([]);
  });

  it("renvoie la compo enrichie avec les labels FR/EN quand le dictionnaire est dispo", async () => {
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: "ACIERINOXYDABLE",
        Composition_1_Percentage__c: "100.0000",
      }),
      compositionsDictResponse([
        {
          Id: 111,
          Uid: "a0zW5000000YvezIAC",
          Name: "Stainless steel",
          Code: "ACIERINOXYDABLE",
          Categories: ["JEWELRY"],
          LabelFR: "Acier inoxydable",
          LabelEN: "Stainless steel",
          LabelDE: "Rostfreier Stahl",
        },
      ]),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toEqual([
      {
        id: "a0zW5000000YvezIAC",
        reference: "ACIERINOXYDABLE",
        percentage: 100,
        labels: { fr: "Acier inoxydable", en: "Stainless steel", de: "Rostfreier Stahl" },
      },
    ]);
  });

  it("filtre les slots vides intercalés (compo 1 + 3 mais pas 2)", async () => {
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: "SILVER",
        Composition_1_Percentage__c: "92.5000",
        Composition_2__c: null,
        Composition_3__c: "PEARL",
        Composition_3_Percentage__c: "7.5000",
      }),
      compositionsDictResponse([
        { Id: 110, Uid: "silver-uid", Name: "Silver 925", Code: "SILVER", Categories: ["JEWELRY"], LabelFR: "Argent 925" },
        { Id: 103, Uid: "pearl-uid", Name: "Pearl", Code: "PEARL", Categories: ["JEWELRY"], LabelFR: "Perle" },
      ]),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ reference: "SILVER", percentage: 92.5, labels: { fr: "Argent 925" } });
    expect(result[1]).toMatchObject({ reference: "PEARL", percentage: 7.5, labels: { fr: "Perle" } });
  });

  it("renvoie tout de même la compo (codes bruts + labels vides) si le dictionnaire échoue", async () => {
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: "STEEL",
        Composition_1_Percentage__c: "100.0000",
      }),
      { ok: false, status: 500, text: async () => "dict endpoint down" },
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toEqual([
      { id: "STEEL", reference: "STEEL", percentage: 100, labels: {} },
    ]);
  });

  it("passe l'auth Bearer + AemikSEAUID dans le body de chaque POST admin", async () => {
    const { calls } = stubFetch([
      loginSuccessResponse("token-abc"),
      productResponse({
        Composition_1__c: "WOOD",
        Composition_1_Percentage__c: "100.0000",
      }),
      compositionsDictResponse([]),
    ]);
    await pfsAdminFetchMaterialComposition("pro_test");
    // Call 0 = login (username + password + AemikSEAUID, pas de Bearer)
    expect(calls[0].url).toContain("/api/auth/seller");
    expect(calls[0].body).toMatchObject({
      username: "issyma@example.com",
      password: "fake-pw",
      AemikSEAUID: "AemikWeb3_PFSBKOFFICE",
    });
    // Call 1 = product/get (Bearer + AemikSEAUID)
    expect(calls[1].url).toContain("/api/v1/product/get/pro_test");
    expect(calls[1].headers.Authorization).toBe("Bearer token-abc");
    expect(calls[1].body).toEqual({ AemikSEAUID: "AemikWeb3_PFSBKOFFICE" });
    // Call 2 = attributes/composition (Bearer + AemikSEAUID + Category)
    expect(calls[2].url).toContain("/api/v1/attributes/composition");
    expect(calls[2].body).toEqual({
      AemikSEAUID: "AemikWeb3_PFSBKOFFICE",
      Category: "a045J00000BO0vRQAT",
    });
  });

  it("réutilise le token en cache sans re-login sur les appels suivants", async () => {
    const { calls } = stubFetch([
      loginSuccessResponse("t1"),
      productResponse({
        Composition_1__c: "COTTON",
        Composition_1_Percentage__c: "100.0000",
      }),
      compositionsDictResponse([]),
      // 2ᵉ appel : pas de login attendu, on va directement à product/get
      productResponse({
        Composition_1__c: "LINEN",
        Composition_1_Percentage__c: "100.0000",
      }),
      compositionsDictResponse([]),
    ]);
    await pfsAdminFetchMaterialComposition("pro_a");
    await pfsAdminFetchMaterialComposition("pro_b");
    const loginCalls = calls.filter((c) => c.url.includes("/api/auth/seller"));
    expect(loginCalls).toHaveLength(1);
  });

  it("re-login automatique sur 401 puis rejoue la requête", async () => {
    const { calls } = stubFetch([
      loginSuccessResponse("initial-token"),
      { ok: false, status: 401, text: async () => "token expired" },
      loginSuccessResponse("new-token"),
      productResponse({
        Composition_1__c: "STEEL",
        Composition_1_Percentage__c: "100.0000",
      }),
      compositionsDictResponse([]),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toHaveLength(1);
    const loginCalls = calls.filter((c) => c.url.includes("/api/auth/seller"));
    expect(loginCalls).toHaveLength(2);
    // Le second product/get doit utiliser le nouveau token
    const productCalls = calls.filter((c) => c.url.includes("/product/get/"));
    expect(productCalls[1]?.headers.Authorization).toBe("Bearer new-token");
  });

  it("lève une erreur claire si identifiants PFS manquants", async () => {
    const cached = await import("@/lib/cached-data");
    (cached.getCachedPfsCredentials as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      email: null,
      password: null,
    });
    stubFetch([]);
    await expect(pfsAdminFetchMaterialComposition("pro_test")).rejects.toThrow(/Identifiants PFS manquants/);
  });

  it("matche Composition_N__c contre Name dict et remonte le Code canonique + Uid (cas Elastane)", async () => {
    // Bug PFS chez issyma : Composition_2__c stocke le texte "Elastane"
    // (le Name du dict) au lieu du Code canonique "ELASTHANNE". Notre code
    // doit retrouver l'entrée dict via son Name et renvoyer le Code +
    // Uid canoniques — sinon downstream on cherche pfsCompositionRef=Elastane
    // qui n'existe pas.
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: "Elastane",
        Composition_1_Percentage__c: "5.0000",
      }),
      compositionsDictResponse([
        {
          Id: 111,
          Uid: "a0z58000000d3bbAAA",
          Name: "Elastane",
          Code: "ELASTHANNE",
          Categories: ["CLOTH"],
          LabelFR: "Élasthanne",
          LabelEN: "Elastane",
        },
      ]),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toEqual([
      {
        id: "a0z58000000d3bbAAA",
        reference: "ELASTHANNE",
        percentage: 5,
        labels: { fr: "Élasthanne", en: "Elastane" },
      },
    ]);
  });

  it("matche Composition_N__c contre LabelFR (accents/points) et normalise vers Code canonique (cas P.U.)", async () => {
    // Composition_1__c stocke "P.U." avec points, dict a Code="PU" + Name="P.U.".
    // La normalisation strip les points → match trouvé, renvoyé avec Code="PU".
    stubFetch([
      loginSuccessResponse(),
      productResponse({
        Composition_1__c: "P.U.",
        Composition_1_Percentage__c: "50.0000",
      }),
      compositionsDictResponse([
        {
          Id: 222,
          Uid: "a0z58000000d3d3AAA",
          Name: "P.U.",
          Code: "PU",
          Categories: ["CLOTH"],
          LabelFR: "P.U.",
          LabelEN: "P.U.",
        },
      ]),
    ]);
    const result = await pfsAdminFetchMaterialComposition("pro_test");
    expect(result).toEqual([
      {
        id: "a0z58000000d3d3AAA",
        reference: "PU",
        percentage: 50,
        labels: { fr: "P.U.", en: "P.U." },
      },
    ]);
  });

  it("lève une erreur si l'API admin répond Status != SUCCEEDED au login", async () => {
    stubFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({ Response: { Status: "FAILED", Message: {} } }),
      },
    ]);
    await expect(pfsAdminFetchMaterialComposition("pro_test")).rejects.toThrow(/Token manquant/);
  });
});
