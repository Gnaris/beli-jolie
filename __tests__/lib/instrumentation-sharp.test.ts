import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * VPS 2 cœurs : on vérifie qu'au chargement du module instrumentation,
 * sharp est bridé à 1 thread par opération pour ne pas saturer le CPU
 * pendant les imports d'images PFS.
 */

const concurrencyMock = vi.fn();
const warnMock = vi.fn();

vi.mock("sharp", () => ({
  default: { concurrency: concurrencyMock },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: warnMock,
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("instrumentation-node — sharp bridé", () => {
  beforeEach(() => {
    concurrencyMock.mockReset();
    warnMock.mockReset();
    vi.resetModules();
    // Le module utilise un Symbol.for global pour éviter la double-instalation —
    // on l'efface avant chaque test pour pouvoir le re-charger proprement.
    const guardKey = Symbol.for("beliandjolie.instrumentation.installed");
    delete (globalThis as Record<symbol, unknown>)[guardKey];
  });

  it("appelle sharp.concurrency(1) au chargement", async () => {
    await import("@/instrumentation-node");
    expect(concurrencyMock).toHaveBeenCalledWith(1);
    expect(concurrencyMock).toHaveBeenCalledTimes(1);
  });

  it("loggue un warning si sharp.concurrency lève (et n'empêche pas l'install des handlers)", async () => {
    concurrencyMock.mockImplementation(() => {
      throw new Error("sharp KO");
    });
    await import("@/instrumentation-node");
    expect(warnMock).toHaveBeenCalled();
    const [msg, meta] = warnMock.mock.calls[0];
    expect(msg).toContain("Sharp");
    expect(meta).toMatchObject({ error: expect.any(Error) });
  });
});
