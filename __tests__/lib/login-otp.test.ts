import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type OtpRow = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
};

const store: { rows: OtpRow[] } = { rows: [] };
let idCounter = 0;

function nowDate() {
  return new Date();
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginOtp: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = store.rows.filter((r) => {
          if (where?.email && r.email !== where.email) return false;
          if (where?.usedAt === null && r.usedAt !== null) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          rows = [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
        }
        return rows[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of store.rows) {
          if (where.email && row.email !== where.email) continue;
          if (where.usedAt === null && row.usedAt !== null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: OtpRow = {
          id: `otp_${++idCounter}`,
          email: data.email,
          codeHash: data.codeHash,
          expiresAt: data.expiresAt,
          attempts: data.attempts ?? 0,
          usedAt: data.usedAt ?? null,
          createdAt: nowDate(),
        };
        store.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.rows.find((r) => r.id === where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Beli Jolie"),
  getCachedSmtpConfig: vi.fn(async () => ({
    host: null,
    port: null,
    secure: null,
    user: null,
    password: null,
    fromEmail: null,
    fromName: null,
    notifyEmail: null,
  })),
}));

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async () => ({ sent: false, reason: "no_config" as const })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  createLoginOtp,
  generateOtpCode,
  getResendCooldownRemaining,
  hashOtpCode,
  verifyLoginOtp,
} from "@/lib/login-otp";

describe("login-otp", () => {
  beforeEach(() => {
    store.rows = [];
    idCounter = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("generateOtpCode", () => {
    it("produit exactement 6 chiffres", () => {
      for (let i = 0; i < 50; i++) {
        const code = generateOtpCode();
        expect(code).toHaveLength(OTP_CODE_LENGTH);
        expect(code).toMatch(/^\d{6}$/);
      }
    });
  });

  describe("hashOtpCode", () => {
    it("est déterministe pour un même code", () => {
      expect(hashOtpCode("123456")).toBe(hashOtpCode("123456"));
    });

    it("produit des hachages différents pour des codes différents", () => {
      expect(hashOtpCode("123456")).not.toBe(hashOtpCode("654321"));
    });

    it("ne révèle jamais le code en clair", () => {
      const hash = hashOtpCode("999999");
      expect(hash).not.toContain("999999");
      expect(hash).toHaveLength(64); // sha256 hex
    });
  });

  describe("createLoginOtp + verifyLoginOtp", () => {
    it("code valide → succès, puis marque le code comme utilisé", async () => {
      const code = await createLoginOtp("user@example.com");
      expect(code).toMatch(/^\d{6}$/);

      const ok = await verifyLoginOtp("user@example.com", code);
      expect(ok).toEqual({ success: true });

      const again = await verifyLoginOtp("user@example.com", code);
      expect(again).toEqual({ success: false, reason: "not_found" });
    });

    it("normalise l'email (trim + lowercase)", async () => {
      const code = await createLoginOtp("  User@Example.COM ");
      const ok = await verifyLoginOtp("USER@EXAMPLE.com", code);
      expect(ok).toEqual({ success: true });
    });

    it("code incorrect → échec 'invalid_code' et incrémente attempts", async () => {
      await createLoginOtp("user@example.com");
      const res = await verifyLoginOtp("user@example.com", "000000");
      expect(res).toEqual({ success: false, reason: "invalid_code" });
      expect(store.rows[0].attempts).toBe(1);
    });

    it("après 5 tentatives échouées, le code est invalidé", async () => {
      await createLoginOtp("user@example.com");
      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
        const r = await verifyLoginOtp("user@example.com", "000000");
        expect(r).toEqual({ success: false, reason: "invalid_code" });
      }
      const final = await verifyLoginOtp("user@example.com", "000000");
      expect(final).toEqual({ success: false, reason: "too_many_attempts" });
      // Même avec le bon code ensuite, c'est mort
      const after = await verifyLoginOtp("user@example.com", "123456");
      expect(after).toEqual({ success: false, reason: "not_found" });
    });

    it("code expiré → échec 'expired'", async () => {
      const code = await createLoginOtp("user@example.com");
      vi.setSystemTime(new Date(Date.now() + OTP_TTL_MS + 1000));
      const res = await verifyLoginOtp("user@example.com", code);
      expect(res).toEqual({ success: false, reason: "expired" });
    });

    it("générer un nouveau code invalide le précédent", async () => {
      const first = await createLoginOtp("user@example.com");
      vi.setSystemTime(new Date(Date.now() + 1000));
      const second = await createLoginOtp("user@example.com");
      expect(first).not.toBe(second); // extrêmement probable

      const usedOld = await verifyLoginOtp("user@example.com", first);
      expect(usedOld.success).toBe(false);

      const usedNew = await verifyLoginOtp("user@example.com", second);
      expect(usedNew).toEqual({ success: true });
    });

    it("aucun code → 'not_found'", async () => {
      const res = await verifyLoginOtp("nobody@example.com", "123456");
      expect(res).toEqual({ success: false, reason: "not_found" });
    });
  });

  describe("getResendCooldownRemaining", () => {
    it("retourne 0 si aucun code antérieur", async () => {
      const ms = await getResendCooldownRemaining("user@example.com");
      expect(ms).toBe(0);
    });

    it("retourne un délai restant > 0 juste après l'émission", async () => {
      await createLoginOtp("user@example.com");
      const ms = await getResendCooldownRemaining("user@example.com");
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_MS);
    });

    it("retourne 0 une fois la fenêtre de cooldown passée", async () => {
      await createLoginOtp("user@example.com");
      vi.setSystemTime(new Date(Date.now() + OTP_RESEND_COOLDOWN_MS + 1));
      const ms = await getResendCooldownRemaining("user@example.com");
      expect(ms).toBe(0);
    });
  });
});
