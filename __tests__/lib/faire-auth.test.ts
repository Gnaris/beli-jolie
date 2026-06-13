import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/cached-data", () => ({
  getCachedFaireApiKey: vi.fn().mockResolvedValue(null),
}));

import {
  FAIRE_BASE_URL,
  getFaireApiKey,
  getFaireHeaders,
  primeFaireApiKey,
  testFaireApiKey,
} from "@/lib/faire-auth";

describe("FAIRE_BASE_URL", () => {
  it("pointe vers l'API v2 (la v1 est dépréciée depuis 2025-12-15)", () => {
    expect(FAIRE_BASE_URL).toBe("https://www.faire.com/external-api/v2");
  });
});

describe("getFaireApiKey / primeFaireApiKey", () => {
  beforeEach(() => primeFaireApiKey(""));

  it("retourne null si aucune clé en BDD ni amorcée", async () => {
    expect(await getFaireApiKey()).toBeNull();
  });

  it("retourne la clé amorcée en priorité (mode CLI)", async () => {
    primeFaireApiKey("test_key_123");
    expect(await getFaireApiKey()).toBe("test_key_123");
  });

  it("trim la clé amorcée", async () => {
    primeFaireApiKey("  test_key_456  ");
    expect(await getFaireApiKey()).toBe("test_key_456");
  });
});

describe("getFaireHeaders", () => {
  beforeEach(() => primeFaireApiKey(""));

  it("throw si pas de clé configurée", async () => {
    await expect(getFaireHeaders()).rejects.toThrow(/Clé API Faire manquante/);
  });

  it("retourne X-FAIRE-ACCESS-TOKEN + User-Agent réaliste", async () => {
    primeFaireApiKey("test_key_789");
    const h = await getFaireHeaders();
    expect(h["X-FAIRE-ACCESS-TOKEN"]).toBe("test_key_789");
    expect(h["Accept"]).toBe("application/json");
    // UA non-bot — Cloudflare devant www.faire.com renvoie 403 sur les UA par défaut
    expect(h["User-Agent"]).toMatch(/Mozilla\/5\.0/);
  });
});

describe("testFaireApiKey", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retourne invalid pour clé vide", async () => {
    const r = await testFaireApiKey("");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/vide/);
  });

  it("retourne valid sur HTTP 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 }) as never;
    const r = await testFaireApiKey("good_key");
    expect(r.valid).toBe(true);
  });

  it("retourne invalid sur HTTP 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 401 }) as never;
    const r = await testFaireApiKey("bad_key");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalide/i);
  });

  it("retourne invalid sur HTTP 403 (Cloudflare ou perm)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 403 }) as never;
    const r = await testFaireApiKey("blocked_key");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalide|révoquée/i);
  });

  it("retourne erreur explicite sur 5xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 503 }) as never;
    const r = await testFaireApiKey("any_key");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/503|Réessayez/i);
  });

  it("retourne 'Impossible de contacter Faire' sur erreur réseau", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ENETUNREACH")) as never;
    const r = await testFaireApiKey("any_key");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/contacter Faire/);
  });

  it("appelle bien GET /products?limit=10&page=1 avec le bon header", async () => {
    const spy = vi.fn().mockResolvedValue({ status: 200 });
    global.fetch = spy as never;
    await testFaireApiKey("test_key_abc");
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/external-api/v2/products?limit=10&page=1");
    expect(init.method).toBe("GET");
    expect(init.headers["X-FAIRE-ACCESS-TOKEN"]).toBe("test_key_abc");
  });
});
