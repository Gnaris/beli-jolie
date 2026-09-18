/**
 * Route `.well-known/apple-developer-merchantid-domain-association` : Apple
 * exige que ce fichier soit servi en text/plain au chemin exact — sinon les
 * navigateurs Safari refusent de proposer Apple Pay, même si le domaine est
 * enregistré côté Stripe.
 *
 * On teste :
 *  - fetch OK → renvoie le body Stripe tel quel + bon Content-Type
 *  - fetch KO → renvoie le fallback local (jamais 500, sinon Apple invalide
 *    tous les domaines pendant l'incident)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("GET /.well-known/apple-developer-merchantid-domain-association", () => {
  it("renvoie le fichier fetché chez Stripe avec Content-Type text/plain", async () => {
    const stripeBody =
      "STRIPE_APPLE_PAY_FILE_CONTENT_" + Math.random().toString(36);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => stripeBody,
    }) as unknown as typeof fetch;

    const { GET } = await import(
      "@/app/.well-known/apple-developer-merchantid-domain-association/route"
    );
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toBe(stripeBody);
  });

  it("retombe sur le fallback local si le fetch Stripe échoue", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const { GET } = await import(
      "@/app/.well-known/apple-developer-merchantid-domain-association/route"
    );
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("retombe sur le fallback local si Stripe renvoie un 5xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service unavailable",
    }) as unknown as typeof fetch;

    const { GET } = await import(
      "@/app/.well-known/apple-developer-merchantid-domain-association/route"
    );
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});
