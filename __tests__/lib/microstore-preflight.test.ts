/**
 * Preflight Microstore : refuse tout envoi produit tant que la Gestion Produits,
 * le token QR compagnon ou la Station de transfert d'images ne sont pas tous
 * les 3 valides. Un seul point d'entrée partagé pour push / update / disable /
 * delete / photos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();
const getSessionKeyMock = vi.fn();
const getStoredStationMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findMany: findManyMock } },
}));
vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: () => "tenant-beliandjolie",
}));
vi.mock("@/lib/microstore-auth", () => ({
  getMicrostoreSessionKey: getSessionKeyMock,
}));
vi.mock("@/lib/microstore-picture-station", () => ({
  getStoredPictureStation: getStoredStationMock,
}));

const { assertMicrostorePushAllowed } = await import(
  "@/lib/microstore-preflight"
);

const FUTURE_SEC = String(Math.floor(Date.now() / 1000) + 3600 * 24 * 30); // +30 j
const PAST_SEC = String(Math.floor(Date.now() / 1000) - 3600); // -1 h
const stationOk = {
  key: "STATION_KEY",
  expiresAt: new Date(Date.now() + 3600 * 1000),
  shortUrl: null,
};
const stationExpired = {
  key: "STATION_KEY",
  expiresAt: new Date(Date.now() - 3600 * 1000),
  shortUrl: null,
};

beforeEach(() => {
  findManyMock.mockReset();
  getSessionKeyMock.mockReset();
  getStoredStationMock.mockReset();
});

describe("assertMicrostorePushAllowed", () => {
  it("refuse quand la Gestion Produits est désactivée", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_products_management_enabled", value: "false" },
      { key: "microstore_expires_at", value: FUTURE_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(stationOk);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("MANAGEMENT_DISABLED");
      expect(res.error).toMatch(/Gestion des produits|désactivée/i);
    }
  });

  it("refuse quand le token QR compagnon est absent", async () => {
    findManyMock.mockResolvedValue([]);
    getSessionKeyMock.mockResolvedValue(null);
    getStoredStationMock.mockResolvedValue(stationOk);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("SESSION_MISSING");
      expect(res.error).toMatch(/QR/);
    }
  });

  it("refuse quand la date d'expiration de la session est passée", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_expires_at", value: PAST_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(stationOk);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("SESSION_EXPIRED");
  });

  it("refuse quand la Station de transfert n'est pas configurée", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_expires_at", value: FUTURE_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(null);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("PICTURE_STATION_MISSING");
      expect(res.error).toMatch(/Station de transfert/i);
    }
  });

  it("refuse quand la Station de transfert est expirée", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_expires_at", value: FUTURE_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(stationExpired);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("PICTURE_STATION_EXPIRED");
      expect(res.error).toMatch(/expirée/i);
    }
  });

  it("laisse passer quand Gestion Produits + token + Station de transfert sont tous OK", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_products_management_enabled", value: "true" },
      { key: "microstore_expires_at", value: FUTURE_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(stationOk);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(true);
  });

  it("laisse passer quand la clé Gestion Produits est absente (défaut ON)", async () => {
    findManyMock.mockResolvedValue([
      { key: "microstore_expires_at", value: FUTURE_SEC },
    ]);
    getSessionKeyMock.mockResolvedValue("5_XXX");
    getStoredStationMock.mockResolvedValue(stationOk);

    const res = await assertMicrostorePushAllowed();
    expect(res.ok).toBe(true);
  });
});
