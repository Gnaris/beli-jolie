import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type OtpRow = {
  id: string;
  adminId: string;
  tenantId: string | null;
  action: string;
  productIds: unknown;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
};

type SiteConfigRow = {
  tenantId: string | null;
  key: string;
  value: string;
};

const store: { otps: OtpRow[]; siteConfig: SiteConfigRow[] } = {
  otps: [],
  siteConfig: [],
};
let idCounter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminActionOtp: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.otps.find((r) => {
            if (where?.id && r.id !== where.id) return false;
            if (where?.adminId && r.adminId !== where.adminId) return false;
            if (where?.tenantId !== undefined && r.tenantId !== where.tenantId) {
              return false;
            }
            if (where?.action && r.action !== where.action) return false;
            if (where?.usedAt === null && r.usedAt !== null) return false;
            return true;
          }) ?? null
        );
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of store.otps) {
          if (where.adminId && row.adminId !== where.adminId) continue;
          if (where.tenantId !== undefined && row.tenantId !== where.tenantId) continue;
          if (where.action && row.action !== where.action) continue;
          if (where.usedAt === null && row.usedAt !== null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: OtpRow = {
          id: `otp_${++idCounter}`,
          adminId: data.adminId,
          tenantId: data.tenantId ?? null,
          action: data.action,
          productIds: data.productIds,
          codeHash: data.codeHash,
          expiresAt: data.expiresAt,
          attempts: data.attempts ?? 0,
          usedAt: data.usedAt ?? null,
          createdAt: new Date(),
        };
        store.otps.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.otps.find((r) => r.id === where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, data);
        return row;
      }),
    },
    siteConfig: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.siteConfig.filter((r) => {
          if (where?.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
          if (where?.key?.in && !where.key.in.includes(r.key)) return false;
          return true;
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.siteConfig.find((r) => {
            if (where?.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
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
    const existing = store.siteConfig.find(
      (r) => r.tenantId === (opts?.tenantId ?? null) && r.key === key,
    );
    if (existing) existing.value = value;
    else store.siteConfig.push({ tenantId: opts?.tenantId ?? null, key, value });
  }),
  unsetSiteConfig: vi.fn(async (key: string, opts: any) => {
    store.siteConfig = store.siteConfig.filter(
      (r) => !(r.tenantId === (opts?.tenantId ?? null) && r.key === key),
    );
  }),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Beli & Jolie"),
}));

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async () => ({ sent: true, id: "test-msg-id" })),
}));

vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: vi.fn((_: string, value: string) => value),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  createOtpForAction,
  verifyAndConsumeOtp,
  isOtpPauseActive,
  applyPauseChoice,
  guardAdminActionOtp,
  AdminActionOtpError,
  generateOtpCode,
  maskEmail,
} from "@/lib/admin-action-otp";

const TENANT_ID = "tenant_beliandjolie";
const ADMIN_ID = "admin_1";

async function seedRecipient() {
  store.siteConfig.push({
    tenantId: TENANT_ID,
    key: "smtp_from_email",
    value: "contact@beliandjolie.com",
  });
}

describe("admin-action-otp", () => {
  beforeEach(() => {
    store.otps = [];
    store.siteConfig = [];
    idCounter = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("generateOtpCode", () => {
    it("génère un code numérique de 6 chiffres", () => {
      const code = generateOtpCode();
      expect(code).toHaveLength(OTP_CODE_LENGTH);
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  describe("maskEmail", () => {
    it("masque le local sauf les 3 premiers caractères", () => {
      expect(maskEmail("contact@beliandjolie.com")).toBe(
        "con••••@beliandjolie.com",
      );
    });
  });

  describe("createOtpForAction", () => {
    it("échoue si aucun email destinataire configuré", async () => {
      const res = await createOtpForAction({
        action: "delete",
        productIds: ["p1"],
        productLabels: [{ reference: "A2158-BLC", name: "Test" }],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("no_recipient");
    });

    it("crée un OTP et retourne un id + email masqué", async () => {
      await seedRecipient();
      const res = await createOtpForAction({
        action: "delete",
        productIds: ["p1", "p2"],
        productLabels: [
          { reference: "A2158-BLC" },
          { reference: "A2158-BLU" },
        ],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.otpId).toMatch(/^otp_/);
        expect(res.recipientMasked).toBe("con••••@beliandjolie.com");
        expect(res.expiresAt).toBeGreaterThan(Date.now());
      }
      expect(store.otps).toHaveLength(1);
      expect(store.otps[0].action).toBe("delete");
    });

    it("privilégie admin_personal_email (vérifié) sur smtp_from_email", async () => {
      // Deux adresses configurées : la boîte pro (smtp_from_email) et le mail
      // perso vérifié. La priorité est au perso pour que la cliente reste
      // joignable même si la boîte pro est compromise.
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: "smtp_from_email",
        value: "contact@beliandjolie.com",
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: "admin_personal_email",
        value: "perso@gmail.com",
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: "admin_personal_email_verified_at",
        value: String(Date.now()),
      });
      const res = await createOtpForAction({
        action: "delete",
        productIds: ["p1"],
        productLabels: [{ reference: "A" }],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.recipientMasked).toBe("per••@gmail.com");
      }
    });

    it("ignore admin_personal_email s'il n'est pas encore vérifié", async () => {
      // Pas de admin_personal_email_verified_at → on retombe sur smtp_from_email.
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: "smtp_from_email",
        value: "contact@beliandjolie.com",
      });
      store.siteConfig.push({
        tenantId: TENANT_ID,
        key: "admin_personal_email",
        value: "perso@gmail.com",
      });
      const res = await createOtpForAction({
        action: "delete",
        productIds: ["p1"],
        productLabels: [{ reference: "A" }],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.recipientMasked).toBe("con••••@beliandjolie.com");
      }
    });

    it("invalide les OTP précédents non consommés du même admin+action", async () => {
      await seedRecipient();
      const r1 = await createOtpForAction({
        action: "delete",
        productIds: ["p1"],
        productLabels: [{ reference: "A" }],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      const r2 = await createOtpForAction({
        action: "delete",
        productIds: ["p2"],
        productLabels: [{ reference: "B" }],
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
      });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      const first = store.otps.find((o) => o.id === (r1 as any).otpId);
      expect(first?.usedAt).not.toBeNull();
    });
  });

  describe("verifyAndConsumeOtp", () => {
    it("retourne success:true et marque usedAt si le code est correct", async () => {
      await seedRecipient();
      // Trick : on capture le code en interceptant le hash
      const captureCode = "123456";
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const codeHash = hashOtpCode(captureCode);
      const otp: OtpRow = {
        id: "otp_manual",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_manual",
        code: "123456",
        action: "delete",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1"],
      });
      expect(res.success).toBe(true);
      expect(otp.usedAt).not.toBeNull();
    });

    it("retourne invalid_code et incrémente attempts si code faux", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_bad",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash: hashOtpCode("999999"),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_bad",
        code: "000000",
        action: "delete",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1"],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("invalid_code");
      expect(otp.attempts).toBe(1);
    });

    it("bloque après OTP_MAX_ATTEMPTS tentatives", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_locked",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash: hashOtpCode("999999"),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: OTP_MAX_ATTEMPTS - 1,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_locked",
        code: "000000",
        action: "delete",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1"],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("too_many_attempts");
      expect(otp.usedAt).not.toBeNull();
    });

    it("retourne expired si l'OTP a dépassé son TTL", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_old",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash: hashOtpCode("123456"),
        expiresAt: new Date(Date.now() - 1000),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_old",
        code: "123456",
        action: "delete",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1"],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("expired");
    });

    it("retourne wrong_scope si l'action ne correspond pas", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_wrong_action",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash: hashOtpCode("123456"),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_wrong_action",
        code: "123456",
        action: "refresh",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1"],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("wrong_scope");
    });

    it("retourne wrong_scope si la liste de productIds diffère", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_wrong_ids",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1", "p2"],
        codeHash: hashOtpCode("123456"),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      const res = await verifyAndConsumeOtp({
        otpId: "otp_wrong_ids",
        code: "123456",
        action: "delete",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        productIds: ["p1", "p2", "p3"], // p3 pas dans le lot d'origine
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.reason).toBe("wrong_scope");
    });
  });

  describe("pause", () => {
    it("isOtpPauseActive renvoie false par défaut", async () => {
      expect(await isOtpPauseActive(TENANT_ID)).toBe(false);
    });

    it("applyPauseChoice(15min) active la pause 15 min", async () => {
      await applyPauseChoice(TENANT_ID, "15min");
      expect(await isOtpPauseActive(TENANT_ID)).toBe(true);
      // 14 min après : encore actif
      vi.setSystemTime(new Date(Date.now() + 14 * 60 * 1000));
      expect(await isOtpPauseActive(TENANT_ID)).toBe(true);
      // 16 min après : expiré
      vi.setSystemTime(new Date(Date.now() + 3 * 60 * 1000));
      expect(await isOtpPauseActive(TENANT_ID)).toBe(false);
    });

    it("applyPauseChoice(null) supprime la pause", async () => {
      await applyPauseChoice(TENANT_ID, "1h");
      expect(await isOtpPauseActive(TENANT_ID)).toBe(true);
      await applyPauseChoice(TENANT_ID, null);
      expect(await isOtpPauseActive(TENANT_ID)).toBe(false);
    });
  });

  describe("guardAdminActionOtp", () => {
    it("bypass silencieux si pause active", async () => {
      await applyPauseChoice(TENANT_ID, "15min");
      await expect(
        guardAdminActionOtp({
          action: "delete",
          productIds: ["p1"],
          adminId: ADMIN_ID,
          tenantId: TENANT_ID,
          otp: null,
        }),
      ).resolves.toBeUndefined();
    });

    it("lève ADMIN_OTP_REQUIRED si pas d'OTP et pas de pause", async () => {
      await expect(
        guardAdminActionOtp({
          action: "delete",
          productIds: ["p1"],
          adminId: ADMIN_ID,
          tenantId: TENANT_ID,
          otp: null,
        }),
      ).rejects.toBeInstanceOf(AdminActionOtpError);
    });

    it("passe si OTP valide", async () => {
      const { hashOtpCode } = await import("@/lib/admin-action-otp");
      const otp: OtpRow = {
        id: "otp_ok",
        adminId: ADMIN_ID,
        tenantId: TENANT_ID,
        action: "delete",
        productIds: ["p1"],
        codeHash: hashOtpCode("654321"),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
        usedAt: null,
        createdAt: new Date(),
      };
      store.otps.push(otp);
      await expect(
        guardAdminActionOtp({
          action: "delete",
          productIds: ["p1"],
          adminId: ADMIN_ID,
          tenantId: TENANT_ID,
          otp: { otpId: "otp_ok", code: "654321" },
        }),
      ).resolves.toBeUndefined();
      expect(otp.usedAt).not.toBeNull();
    });
  });
});
