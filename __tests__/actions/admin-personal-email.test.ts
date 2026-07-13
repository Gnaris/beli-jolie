import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SiteConfigRow = {
  tenantId: string | null;
  key: string;
  value: string;
};

const store: { siteConfig: SiteConfigRow[] } = { siteConfig: [] };
const TENANT_ID = "tenant_beliandjolie";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.siteConfig.filter((r) => {
          if (where?.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
          if (where?.key?.in && !where.key.in.includes(r.key)) return false;
          if (where?.key && typeof where.key === "string" && r.key !== where.key)
            return false;
          return true;
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.siteConfig.find((r) => {
            if (where?.tenantId !== undefined && r.tenantId !== where.tenantId)
              return false;
            if (where?.key && r.key !== where.key) return false;
            return true;
          }) ?? null
        );
      }),
    },
  },
}));

vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: vi.fn(async (key: string, value: string, opts: any) => {
    const tid = opts?.tenantId ?? TENANT_ID;
    const existing = store.siteConfig.find(
      (r) => r.tenantId === tid && r.key === key,
    );
    if (existing) existing.value = value;
    else store.siteConfig.push({ tenantId: tid, key, value });
  }),
  unsetSiteConfig: vi.fn(async (key: string, opts: any) => {
    const tid = opts?.tenantId ?? TENANT_ID;
    store.siteConfig = store.siteConfig.filter(
      (r) => !(r.tenantId === tid && r.key === key),
    );
  }),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin_1", role: "ADMIN" } },
    tenant: { id: TENANT_ID, slug: "beliandjolie", name: "Beli & Jolie" },
  })),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Beli & Jolie"),
}));

const sendMailMock = vi.fn(async () => ({ sent: true, id: "test-msg-id" }));
vi.mock("@/lib/email", () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...(args as [])),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  sendAdminPersonalEmailOtp,
  verifyAdminPersonalEmailOtp,
  resetPendingAdminPersonalEmail,
  getAdminPersonalEmailState,
  KEY_VERIFIED_EMAIL,
  KEY_VERIFIED_AT,
  KEY_PENDING_EMAIL,
  KEY_OTP_HASH,
  KEY_OTP_EXPIRES,
  KEY_OTP_ATTEMPTS,
  PERSONAL_EMAIL_OTP_TTL_MS,
  PERSONAL_EMAIL_OTP_MAX_ATTEMPTS,
} from "@/app/actions/admin/admin-personal-email";

function seedVerifiedEmail(email: string) {
  store.siteConfig.push({ tenantId: TENANT_ID, key: KEY_VERIFIED_EMAIL, value: email });
  store.siteConfig.push({
    tenantId: TENANT_ID,
    key: KEY_VERIFIED_AT,
    value: String(Date.now()),
  });
}

function currentHash(): string {
  return (
    store.siteConfig.find(
      (r) => r.tenantId === TENANT_ID && r.key === KEY_OTP_HASH,
    )?.value ?? ""
  );
}

describe("admin-personal-email", () => {
  beforeEach(() => {
    store.siteConfig = [];
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ sent: true, id: "test-msg-id" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("sendAdminPersonalEmailOtp", () => {
    it("refuse un email invalide", async () => {
      const res = await sendAdminPersonalEmailOtp("pas-un-email");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("invalid_email");
    });

    it("refuse si un mail perso est déjà vérifié", async () => {
      seedVerifiedEmail("perso@gmail.com");
      const res = await sendAdminPersonalEmailOtp("nouveau@gmail.com");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("already_verified");
    });

    it("retourne smtp_not_ready si sendMail n'a pas de config", async () => {
      sendMailMock.mockResolvedValueOnce({ sent: false, reason: "no_config" });
      const res = await sendAdminPersonalEmailOtp("perso@gmail.com");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("smtp_not_ready");
    });

    it("stocke pending + hash + expiration en cas de succès", async () => {
      const res = await sendAdminPersonalEmailOtp("perso@gmail.com");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.email).toBe("perso@gmail.com");
        expect(res.expiresAt).toBe(Date.now() + PERSONAL_EMAIL_OTP_TTL_MS);
      }
      expect(sendMailMock).toHaveBeenCalledOnce();
      const state = await getAdminPersonalEmailState();
      expect(state.pendingEmail).toBe("perso@gmail.com");
      expect(state.otpAttempts).toBe(0);
      expect(currentHash()).toHaveLength(64);
    });

    it("écrase l'OTP précédent si on renvoie un code", async () => {
      await sendAdminPersonalEmailOtp("perso@gmail.com");
      const firstHash = currentHash();
      await sendAdminPersonalEmailOtp("perso@gmail.com");
      const secondHash = currentHash();
      expect(secondHash).not.toBe(firstHash);
    });

    it("normalise l'email en lowercase + trim", async () => {
      const res = await sendAdminPersonalEmailOtp("  PERSO@Gmail.COM  ");
      expect(res.success).toBe(true);
      if (res.success) expect(res.email).toBe("perso@gmail.com");
    });
  });

  describe("verifyAdminPersonalEmailOtp", () => {
    async function seedPendingWithCode(email: string, code: string) {
      // On passe par le flow réel puis on triche pour connaître le code :
      // send génère un hash aléatoire, donc on remplace directement le hash
      // pour avoir un code connu dans les tests.
      await sendAdminPersonalEmailOtp(email);
      const crypto = await import("crypto");
      const knownHash = crypto.createHash("sha256").update(code).digest("hex");
      const row = store.siteConfig.find(
        (r) => r.tenantId === TENANT_ID && r.key === KEY_OTP_HASH,
      )!;
      row.value = knownHash;
    }

    it("refuse si aucun code en attente", async () => {
      const res = await verifyAdminPersonalEmailOtp("123456");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("no_pending");
    });

    it("refuse si le code est expiré", async () => {
      await seedPendingWithCode("perso@gmail.com", "111111");
      vi.setSystemTime(new Date(Date.now() + PERSONAL_EMAIL_OTP_TTL_MS + 1000));
      const res = await verifyAdminPersonalEmailOtp("111111");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("expired");
    });

    it("refuse un code invalide + incrémente les tentatives", async () => {
      await seedPendingWithCode("perso@gmail.com", "111111");
      const res = await verifyAdminPersonalEmailOtp("222222");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("invalid_code");
        expect(res.attemptsRemaining).toBe(PERSONAL_EMAIL_OTP_MAX_ATTEMPTS - 1);
      }
      const state = await getAdminPersonalEmailState();
      expect(state.otpAttempts).toBe(1);
    });

    it("bloque après le max de tentatives", async () => {
      await seedPendingWithCode("perso@gmail.com", "111111");
      for (let i = 0; i < PERSONAL_EMAIL_OTP_MAX_ATTEMPTS; i++) {
        await verifyAdminPersonalEmailOtp("000000");
      }
      const res = await verifyAdminPersonalEmailOtp("111111");
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("too_many_attempts");
    });

    it("verrouille le mail perso et efface l'OTP quand code correct", async () => {
      await seedPendingWithCode("perso@gmail.com", "111111");
      const res = await verifyAdminPersonalEmailOtp("111111");
      expect(res.success).toBe(true);
      if (res.success) expect(res.email).toBe("perso@gmail.com");
      const state = await getAdminPersonalEmailState();
      expect(state.verifiedEmail).toBe("perso@gmail.com");
      expect(state.verifiedAt).toBeGreaterThan(0);
      expect(state.pendingEmail).toBeNull();
      expect(state.otpExpiresAt).toBeNull();
      expect(currentHash()).toBe("");
    });
  });

  describe("resetPendingAdminPersonalEmail", () => {
    it("efface le pending + hash + expiration sans toucher au verrouillé", async () => {
      seedVerifiedEmail("deja-verifie@gmail.com");
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: KEY_PENDING_EMAIL,
        value: "nouveau@gmail.com",
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: KEY_OTP_HASH,
        value: "abc",
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: KEY_OTP_EXPIRES,
        value: String(Date.now() + 60_000),
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: KEY_OTP_ATTEMPTS,
        value: "2",
      });

      const res = await resetPendingAdminPersonalEmail();
      expect(res.success).toBe(true);
      const state = await getAdminPersonalEmailState();
      expect(state.verifiedEmail).toBe("deja-verifie@gmail.com");
      expect(state.pendingEmail).toBeNull();
      expect(state.otpExpiresAt).toBeNull();
      expect(state.otpAttempts).toBe(0);
    });
  });

  describe("getAdminPersonalEmailState", () => {
    it("retourne des null quand aucune clé n'existe", async () => {
      const state = await getAdminPersonalEmailState();
      expect(state).toEqual({
        verifiedEmail: null,
        verifiedAt: null,
        pendingEmail: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      });
    });
  });
});
