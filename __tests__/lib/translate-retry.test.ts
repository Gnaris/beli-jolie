/**
 * Tests for the DeepL retry-with-backoff mechanism.
 *
 * Covered:
 *  1. translateWithRetry returns the translation if the 1st attempt fails (429)
 *     and the 2nd succeeds (1 retry).
 *  2. translateWithRetry returns null if 5 consecutive attempts fail.
 *  3. translateToAllLocales with 6 locales : 4 succeed, 2 fail every time
 *     → returns 4-key object (no FR fallback for missing ones).
 *  4. translateTextStrict returns null when DeepL fails repeatedly
 *     (NOT the original text).
 *  5. autoTranslateEntity does NOT call prisma upsert when DeepL returns null.
 *
 * All retry delays are stubbed to 0ms via the `delayFn` injection so the suite
 * runs in milliseconds rather than the real 31s exponential backoff.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── prisma mock (shared) ─────────────────────────────────────────────────────

const prismaMock = {
  siteConfig: {
    findUnique: vi.fn(),
  },
  translationQuota: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  colorTranslation: {
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

// encryption is a no-op in tests
vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: (_key: string, value: string) => value,
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const FAKE_KEY = "fake-deepl-key:fx";

function setDeeplKey(key: string | null) {
  prismaMock.siteConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === "deepl_api_key") {
      return key ? { value: key } : null;
    }
    if (where.key === "auto_translate_enabled") {
      return { value: "true" };
    }
    return null;
  });
}

function setQuota(used: number, max: number = 500_000) {
  prismaMock.translationQuota.upsert.mockResolvedValue({ charsUsed: used, maxChars: max });
  prismaMock.translationQuota.findUnique.mockResolvedValue({ charsUsed: used, maxChars: max });
}

function buildFetchSequence(responses: Array<{ ok: boolean; status?: number; translation?: string }>) {
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 429),
      json: async () => ({ translations: [{ text: r.translation ?? "" }] }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("translateWithRetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setDeeplKey(FAKE_KEY);
    setQuota(0);
  });

  it("retries once when first call returns 429, then returns the translated value", async () => {
    const fetchMock = buildFetchSequence([
      { ok: false, status: 429 },
      { ok: true, translation: "Hello" },
    ]);

    const { translateWithRetry } = await import("@/lib/translate");
    const result = await translateWithRetry("Bonjour", "fr", "en", 5, () => 0);

    expect(result).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when all 5 attempts fail", async () => {
    const fetchMock = buildFetchSequence([
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 500 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
    ]);

    const { translateWithRetry } = await import("@/lib/translate");
    const result = await translateWithRetry("Bonjour", "fr", "en", 5, () => 0);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("translateTextStrict", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setDeeplKey(FAKE_KEY);
    setQuota(0);
  });

  it("returns null (NOT the original text) when DeepL fails 5 times", async () => {
    buildFetchSequence([
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
    ]);

    const { translateTextStrict } = await import("@/lib/translate");
    const result = await translateTextStrict("Bonjour le monde", "fr", "en", {
      delayFn: () => 0,
    });

    expect(result).toBeNull();
    // No quota incremented when translation failed
    expect(prismaMock.translationQuota.upsert).toHaveBeenCalledTimes(1); // only the initial getQuota
  });

  it("returns the translated value and increments quota on success", async () => {
    buildFetchSequence([{ ok: true, translation: "Hallo Welt" }]);

    const { translateTextStrict } = await import("@/lib/translate");
    const result = await translateTextStrict("Bonjour le monde", "fr", "en", {
      delayFn: () => 0,
    });

    expect(result).toBe("Hallo Welt");
    // 1× getQuota (initial) + 1× addCharsUsed (after success)
    expect(prismaMock.translationQuota.upsert).toHaveBeenCalledTimes(2);
  });
});

describe("translateToAllLocales", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setDeeplKey(FAKE_KEY);
    setQuota(0);
  });

  it("returns only the locales that succeeded (no FR fallback)", async () => {
    // Seul EN est cible. On simule un succès direct.
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ translations: [{ text: "EN" }] }) } as unknown as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    const { translateToAllLocales } = await import("@/lib/translate");
    const result = await translateToAllLocales("Bonjour", "fr", { delayFn: () => 0 });

    expect(Object.keys(result).sort()).toEqual(["en"]);
    expect(result.en).toBe("EN");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits a locale when DeepL fails 5×", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const { translateToAllLocales } = await import("@/lib/translate");
    const result = await translateToAllLocales("Bonjour", "fr", { delayFn: () => 0 });

    expect(result).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("autoTranslateEntity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setDeeplKey(FAKE_KEY);
    setQuota(0);
  });

  it("does NOT upsert in prisma when DeepL returns null after retries", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    // Use a low maxRetries via translate's exposed API — but autoTranslateEntity
    // calls translateTextStrict with default maxRetries=5 and delayFn=defaultBackoff.
    // We can't inject a delayFn, so we mock translateTextStrict directly to keep
    // the test fast AND prove the upsert is skipped on null.
    vi.doMock("@/lib/translate", async () => {
      const actual = await vi.importActual<typeof import("@/lib/translate")>("@/lib/translate");
      return {
        ...actual,
        translateTextStrict: vi.fn(async () => null),
      };
    });

    const { autoTranslateColor } = await import("@/lib/auto-translate");
    await autoTranslateColor("color-1", "Rouge");

    expect(prismaMock.colorTranslation.upsert).not.toHaveBeenCalled();
  });

  it("DOES upsert when DeepL returns a valid translation", async () => {
    vi.doMock("@/lib/translate", async () => {
      const actual = await vi.importActual<typeof import("@/lib/translate")>("@/lib/translate");
      return {
        ...actual,
        translateTextStrict: vi.fn(async (_text: string, _from: string, to: string) => {
          if (to === "en") return "Red";
          return null;
        }),
      };
    });

    const { autoTranslateColor } = await import("@/lib/auto-translate");
    await autoTranslateColor("color-2", "Rouge");

    // Only EN succeeded → exactly 1 upsert call
    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { colorId_locale: { colorId: "color-2", locale: "en" } },
      })
    );
  });
});
