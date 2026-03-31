/**
 * Tests for lib/security.ts
 * Login lockout logic, registration spam prevention, IP extraction.
 * Prisma is mocked — these test the business logic, not the DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Prisma — vi.hoisted ensures the variable is available when vi.mock factory runs
const mockPrisma = vi.hoisted(() => ({
  accountLockout: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  loginAttempt: {
    create: vi.fn(),
  },
  registrationLog: {
    count: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import {
  checkLoginLockout,
  recordLoginFailure,
  recordLoginSuccess,
  checkRegistrationSpam,
  logRegistration,
  getClientIp,
} from "@/lib/security";

describe("lib/security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── checkLoginLockout ─────────────────────────────────────────

  describe("checkLoginLockout", () => {
    it("should return null when no lockout exists", async () => {
      mockPrisma.accountLockout.findUnique.mockResolvedValue(null);
      const result = await checkLoginLockout("user@test.com");
      expect(result).toBeNull();
    });

    it("should return permanent block message", async () => {
      mockPrisma.accountLockout.findUnique.mockResolvedValue({
        email: "user@test.com",
        permanent: true,
        lockedUntil: null,
        lockoutLevel: 11,
      });
      const result = await checkLoginLockout("user@test.com");
      expect(result).toContain("bloqué définitivement");
    });

    it("should return temporary block message when locked", async () => {
      const lockedUntil = new Date(Date.now() + 300_000); // 5 min from now
      mockPrisma.accountLockout.findUnique.mockResolvedValue({
        email: "user@test.com",
        permanent: false,
        lockedUntil,
        lockoutLevel: 2,
      });
      const result = await checkLoginLockout("user@test.com");
      expect(result).toContain("temporairement bloqué");
      expect(result).toContain("minute");
    });

    it("should return null when lockout has expired", async () => {
      const lockedUntil = new Date(Date.now() - 1000); // expired 1s ago
      mockPrisma.accountLockout.findUnique.mockResolvedValue({
        email: "user@test.com",
        permanent: false,
        lockedUntil,
        lockoutLevel: 1,
      });
      const result = await checkLoginLockout("user@test.com");
      expect(result).toBeNull();
    });

    it("should normalize email to lowercase", async () => {
      mockPrisma.accountLockout.findUnique.mockResolvedValue(null);
      await checkLoginLockout("User@TEST.COM");
      expect(mockPrisma.accountLockout.findUnique).toHaveBeenCalledWith({
        where: { email: "user@test.com" },
      });
    });

    it("should format duration in hours", async () => {
      const lockedUntil = new Date(Date.now() + 7200_000); // 2 hours
      mockPrisma.accountLockout.findUnique.mockResolvedValue({
        email: "user@test.com",
        permanent: false,
        lockedUntil,
        lockoutLevel: 5,
      });
      const result = await checkLoginLockout("user@test.com");
      expect(result).toContain("heure");
    });
  });

  // ─── recordLoginFailure ────────────────────────────────────────

  describe("recordLoginFailure", () => {
    it("should create login attempt and upsert lockout", async () => {
      mockPrisma.loginAttempt.create.mockResolvedValue({});
      mockPrisma.accountLockout.upsert.mockResolvedValue({
        failureCount: 0,
        lockoutLevel: 0,
      });

      await recordLoginFailure("user@test.com", "1.2.3.4");

      expect(mockPrisma.loginAttempt.create).toHaveBeenCalledWith({
        data: { email: "user@test.com", ip: "1.2.3.4", success: false },
      });
      expect(mockPrisma.accountLockout.upsert).toHaveBeenCalled();
    });

    it("should not trigger lockout before 3 failures", async () => {
      mockPrisma.loginAttempt.create.mockResolvedValue({});
      mockPrisma.accountLockout.upsert.mockResolvedValue({
        failureCount: 0, // before increment = 1 after
        lockoutLevel: 0,
      });

      await recordLoginFailure("user@test.com", "1.2.3.4");
      expect(mockPrisma.accountLockout.update).not.toHaveBeenCalled();
    });

    it("should trigger level 1 lockout (1 min) after 3 failures", async () => {
      mockPrisma.loginAttempt.create.mockResolvedValue({});
      mockPrisma.accountLockout.upsert.mockResolvedValue({
        failureCount: 2, // +1 = 3, which >= MAX_ATTEMPTS_BEFORE_LOCKOUT
        lockoutLevel: 0,
      });
      mockPrisma.accountLockout.update.mockResolvedValue({});

      await recordLoginFailure("user@test.com", "1.2.3.4");

      expect(mockPrisma.accountLockout.update).toHaveBeenCalledWith({
        where: { email: "user@test.com" },
        data: expect.objectContaining({
          lockoutLevel: 1,
          lockedUntil: expect.any(Date),
        }),
      });
    });

    it("should trigger permanent lockout at level 11", async () => {
      mockPrisma.loginAttempt.create.mockResolvedValue({});
      mockPrisma.accountLockout.upsert.mockResolvedValue({
        failureCount: 2,
        lockoutLevel: 10, // next = 11 = permanent
      });
      mockPrisma.accountLockout.update.mockResolvedValue({});

      await recordLoginFailure("user@test.com", "1.2.3.4");

      expect(mockPrisma.accountLockout.update).toHaveBeenCalledWith({
        where: { email: "user@test.com" },
        data: expect.objectContaining({
          lockoutLevel: 11,
          permanent: true,
          lockedUntil: null,
        }),
      });
    });
  });

  // ─── recordLoginSuccess ────────────────────────────────────────

  describe("recordLoginSuccess", () => {
    it("should log success and delete lockout", async () => {
      mockPrisma.loginAttempt.create.mockResolvedValue({});
      mockPrisma.accountLockout.deleteMany.mockResolvedValue({});

      await recordLoginSuccess("user@test.com", "1.2.3.4");

      expect(mockPrisma.loginAttempt.create).toHaveBeenCalledWith({
        data: { email: "user@test.com", ip: "1.2.3.4", success: true },
      });
      expect(mockPrisma.accountLockout.deleteMany).toHaveBeenCalledWith({
        where: { email: "user@test.com" },
      });
    });
  });

  // ─── checkRegistrationSpam ─────────────────────────────────────

  describe("checkRegistrationSpam", () => {
    it("should return null when no recent registrations", async () => {
      mockPrisma.registrationLog.count.mockResolvedValue(0);
      const result = await checkRegistrationSpam("1.2.3.4", "new@test.com", "0612345678", "12345678901234");
      expect(result).toBeNull();
    });

    it("should block duplicate IP", async () => {
      mockPrisma.registrationLog.count.mockImplementation(({ where }: any) => {
        if (where.ip) return Promise.resolve(1);
        return Promise.resolve(0);
      });
      const result = await checkRegistrationSpam("1.2.3.4", "new@test.com", "0612345678", "12345678901234");
      expect(result).toContain("adresse");
    });

    it("should block duplicate email", async () => {
      mockPrisma.registrationLog.count.mockImplementation(({ where }: any) => {
        if (where.email) return Promise.resolve(1);
        return Promise.resolve(0);
      });
      const result = await checkRegistrationSpam("9.9.9.9", "dup@test.com", "0612345678", "12345678901234");
      expect(result).toContain("email");
    });

    it("should block duplicate phone", async () => {
      mockPrisma.registrationLog.count.mockImplementation(({ where }: any) => {
        if (where.phone) return Promise.resolve(1);
        return Promise.resolve(0);
      });
      const result = await checkRegistrationSpam("9.9.9.9", "new@test.com", "0612345678", "12345678901234");
      expect(result).toContain("téléphone");
    });

    it("should block duplicate SIRET", async () => {
      mockPrisma.registrationLog.count.mockImplementation(({ where }: any) => {
        if (where.siret) return Promise.resolve(1);
        return Promise.resolve(0);
      });
      const result = await checkRegistrationSpam("9.9.9.9", "new@test.com", "0699999999", "12345678901234");
      expect(result).toContain("SIRET");
    });

    it("should check all criteria in parallel", async () => {
      mockPrisma.registrationLog.count.mockResolvedValue(0);
      await checkRegistrationSpam("1.1.1.1", "a@b.com", "06", "123");
      // 4 parallel counts: IP, phone, siret, email
      expect(mockPrisma.registrationLog.count).toHaveBeenCalledTimes(4);
    });
  });

  // ─── logRegistration ───────────────────────────────────────────

  describe("logRegistration", () => {
    it("should create registration log with normalized email", async () => {
      mockPrisma.registrationLog.create.mockResolvedValue({});
      await logRegistration("1.2.3.4", "User@Test.COM", "06", "123", "MyCompany");
      expect(mockPrisma.registrationLog.create).toHaveBeenCalledWith({
        data: {
          ip: "1.2.3.4",
          email: "user@test.com",
          phone: "06",
          siret: "123",
          company: "MyCompany",
        },
      });
    });
  });

  // ─── getClientIp ───────────────────────────────────────────────

  describe("getClientIp", () => {
    it("should extract from x-forwarded-for", () => {
      const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
      expect(getClientIp(headers)).toBe("1.2.3.4");
    });

    it("should fallback to x-real-ip", () => {
      const headers = new Headers({ "x-real-ip": "10.0.0.1" });
      expect(getClientIp(headers)).toBe("10.0.0.1");
    });

    it("should return 'unknown' when no IP headers", () => {
      expect(getClientIp(new Headers())).toBe("unknown");
    });
  });
});
