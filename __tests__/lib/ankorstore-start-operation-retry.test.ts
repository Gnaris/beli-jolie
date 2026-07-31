/**
 * Test du retry sur `ankorstoreStartOperation` :
 * Ankor renvoie parfois 403 « cannot be updated from [pending] to [started] »
 * quand leur backend n'a pas encore fini de matérialiser l'op. On doit retry
 * avec backoff, mais uniquement sur ce cas précis — les autres 4xx propagent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ankorstoreStartOperation } from "@/lib/ankorstore-api-write";

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

const okResponse = () => ({
  ok: true,
  status: 204,
  text: async () => "",
});

const pendingRaceResponse = () => ({
  ok: false,
  status: 403,
  text: async () =>
    JSON.stringify({
      errors: [
        {
          meta: { error: "Status of the operation cannot be updated from [pending] to [started]." },
          status: "403",
        },
      ],
    }),
  headers: new Headers(),
});

const otherClientErrorResponse = () => ({
  ok: false,
  status: 422,
  text: async () =>
    JSON.stringify({ errors: [{ detail: "Callback url invalid", status: "422" }] }),
  headers: new Headers(),
});

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ankorstoreStartOperation retry sur [pending]→[started]", () => {
  it("réussit sans retry quand Ankor accepte immédiatement", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const promise = ankorstoreStartOperation("op_123");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retry après un [pending] initial, puis succès au 2ᵉ essai", async () => {
    mockFetch
      .mockResolvedValueOnce(pendingRaceResponse())
      .mockResolvedValueOnce(okResponse());

    const promise = ankorstoreStartOperation("op_456");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("finit par échouer après 5 tentatives si Ankor reste bloqué en [pending]", async () => {
    mockFetch
      .mockResolvedValueOnce(pendingRaceResponse())
      .mockResolvedValueOnce(pendingRaceResponse())
      .mockResolvedValueOnce(pendingRaceResponse())
      .mockResolvedValueOnce(pendingRaceResponse())
      .mockResolvedValueOnce(pendingRaceResponse());

    const promise = ankorstoreStartOperation("op_789");
    // Attache le catch AVANT d'avancer les timers pour éviter une
    // unhandled rejection (le reject peut arriver pendant runAllTimersAsync).
    const assertion = expect(promise).rejects.toThrow(/cannot be updated from \[pending\]/i);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(5); // 1 initial + 4 retries
  });

  it("ne retry pas sur un autre 4xx (ex. 422 callback url invalid)", async () => {
    mockFetch.mockResolvedValueOnce(otherClientErrorResponse());

    const promise = ankorstoreStartOperation("op_abc");
    const assertion = expect(promise).rejects.toThrow(/422/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
