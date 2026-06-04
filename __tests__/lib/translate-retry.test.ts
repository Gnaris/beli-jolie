/**
 * Tests for the PFS translation retry-with-backoff mechanism.
 *
 * Couverture :
 *  1. translateWithRetry réessaie sur 429 puis retourne la traduction au succès suivant
 *  2. translateWithRetry retourne null après 5 échecs consécutifs
 *  3. translateTextStrict retourne null sur échec persistant (PAS le texte d'origine)
 *  4. translateToAllLocales retourne uniquement les locales effectivement reçues
 *  5. autoTranslateEntity n'upsert PAS quand la traduction échoue
 *
 * Les delays sont stubbés à 0ms via `delayFn` pour garder la suite rapide.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  siteConfig: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  colorTranslation: {
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: (_key: string, value: string) => value,
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsCredentials: vi.fn(async () => ({
    email: "test@beliandjolie.com",
    password: "fake-pfs-pw",
  })),
}));

vi.mock("@/lib/pfs-auth", () => ({
  getPfsHeaders: vi.fn(async () => ({ Authorization: "Bearer fake" })),
  invalidatePfsToken: vi.fn(),
  PFS_BASE_URL: "https://wholesaler-api.parisfashionshops.com/api/v1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function setAutoTranslate(enabled: boolean) {
  prismaMock.siteConfig.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === "auto_translate_enabled") {
      return { value: enabled ? "true" : "false" };
    }
    return null;
  });
}

/** Stub global fetch with the given sequence of responses. */
function buildFetchSequence(
  responses: Array<{ ok: boolean; status?: number; body?: Record<string, unknown> }>
) {
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 429),
      text: async () => "",
      json: async () => r.body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("translateWithRetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setAutoTranslate(true);
  });

  it("retries once on 429 and returns the translation on next success", async () => {
    const fetchMock = buildFetchSequence([
      { ok: false, status: 429 },
      { ok: true, body: { value: { fr: "Bonjour", en: "Hello" } } },
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
    setAutoTranslate(true);
  });

  it("returns null (not the original text) when PFS fails 5 times", async () => {
    buildFetchSequence([
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
      { ok: false, status: 429 },
    ]);

    const { translateTextStrict } = await import("@/lib/translate");
    const result = await translateTextStrict("Bonjour le monde", "fr", "en", { delayFn: () => 0 });

    expect(result).toBeNull();
  });

  it("returns the translated value on success", async () => {
    buildFetchSequence([
      { ok: true, body: { value: { fr: "Bonjour le monde", en: "Hello world" } } },
    ]);

    const { translateTextStrict } = await import("@/lib/translate");
    const result = await translateTextStrict("Bonjour le monde", "fr", "en", { delayFn: () => 0 });

    expect(result).toBe("Hello world");
  });
});

describe("translateToAllLocales", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setAutoTranslate(true);
  });

  it("returns only the locales that the API actually provided", async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ value: { fr: "Bonjour", en: "Hello" } }),
      }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { translateToAllLocales } = await import("@/lib/translate");
    const result = await translateToAllLocales("Bonjour", "fr", { delayFn: () => 0 });

    expect(Object.keys(result).sort()).toEqual(["en"]);
    expect(result.en).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty object when PFS fails 5×", async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: false,
        status: 429,
        text: async () => "",
        json: async () => ({}),
      }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { translateToAllLocales } = await import("@/lib/translate");
    const result = await translateToAllLocales("Bonjour", "fr", { delayFn: () => 0 });

    expect(result).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("autoTranslateColor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setAutoTranslate(true);
  });

  it("does NOT call prisma upsert when PFS returns null after retries", async () => {
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

  it("DOES call prisma upsert when a valid translation is returned", async () => {
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

    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { colorId_locale: { colorId: "color-2", locale: "en" } },
      })
    );
  });
});
