/**
 * Test que `ankorstoreCreateCatalogOperation` génère son propre UUID côté
 * client et l'envoie dans `data.id`. C'est le pattern documenté par Ankor
 * (spec 2026-05, section Idempotency) qui garantit un opId unique à chaque
 * appel — fini la dédup qui renvoyait le MÊME opId pour deux POST proches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ankorstoreCreateCatalogOperation } from "@/lib/ankorstore-api-write";

vi.mock("@/lib/ankorstore-auth", () => ({
  getAnkorstoreHeaders: vi.fn().mockResolvedValue({
    Authorization: "Bearer x",
    Accept: "application/vnd.api+json",
  }),
  ANKORSTORE_BASE_URL: "https://www.ankorstore.com/api/v1",
  invalidateAnkorstoreToken: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as never;

// Ankor renvoie l'id qu'on lui envoie (comportement idempotent documenté)
const echoResponse = () => (init: RequestInit) => {
  const body = JSON.parse(init.body as string) as {
    data: { id?: string };
  };
  return {
    ok: true,
    status: 201,
    text: async () =>
      JSON.stringify({
        data: {
          id: body.data.id ?? "server-generated",
          type: "catalog-integration-operation",
          attributes: { status: "pending" },
        },
      }),
  };
};

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ankorstoreCreateCatalogOperation — UUID client-side", () => {
  it("envoie un UUID généré côté client dans data.id", async () => {
    mockFetch.mockImplementation((_url, init) => echoResponse()(init as RequestInit));

    const promise = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    const { operationId } = await promise;

    // Format UUID v4 : 8-4-4-4-12 caractères hex, séparés par tirets
    expect(operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data.id).toBe(operationId);
    expect(body.data.type).toBe("catalog-integration-operation");
    expect(body.data.attributes.operationType).toBe("update");
  });

  it("chaque appel génère un UUID DIFFÉRENT (pas de dédup client possible)", async () => {
    mockFetch.mockImplementation((_url, init) => echoResponse()(init as RequestInit));

    const p1 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    const r1 = await p1;

    const p2 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    const r2 = await p2;

    const p3 = ankorstoreCreateCatalogOperation("import");
    await vi.runAllTimersAsync();
    const r3 = await p3;

    expect(r1.operationId).not.toBe(r2.operationId);
    expect(r2.operationId).not.toBe(r3.operationId);
    expect(r1.operationId).not.toBe(r3.operationId);
  });

  it("5 appels concurrents produisent 5 UUIDs distincts", async () => {
    mockFetch.mockImplementation((_url, init) => echoResponse()(init as RequestInit));

    const promises = Array.from({ length: 5 }).map(() =>
      ankorstoreCreateCatalogOperation("update"),
    );
    await vi.runAllTimersAsync();
    const results = await Promise.all(promises);
    const ids = results.map((r) => r.operationId);

    // 5 UUIDs uniques ⇒ pas de collision côté client
    expect(new Set(ids).size).toBe(5);
  });

  it("respecte l'id renvoyé par le serveur s'il diffère (défensif)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          data: {
            id: "server-forced-uuid",
            type: "catalog-integration-operation",
            attributes: {},
          },
        }),
    });

    const promise = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    const { operationId } = await promise;
    expect(operationId).toBe("server-forced-uuid");
  });
});
