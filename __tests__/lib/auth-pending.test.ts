/**
 * Tests for lib/auth.ts — PENDING users can log in, REJECTED cannot.
 * Prisma, bcrypt et la couche "security" sont mockés.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}));

const mockSecurity = vi.hoisted(() => ({
  checkLoginLockout: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));

const mockBcrypt = vi.hoisted(() => ({
  compare: vi.fn(),
}));

const mockOtp = vi.hoisted(() => ({
  verifyLoginOtp: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/security", () => mockSecurity);
vi.mock("@/lib/login-otp", () => mockOtp);
vi.mock("bcryptjs", () => ({ default: mockBcrypt, ...mockBcrypt }));

import { authOptions } from "@/lib/auth";

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: unknown
) => Promise<unknown>;

function getAuthorize(): Authorize {
  // NextAuth wraps `authorize` on the provider — use the raw function
  // from `.options.authorize` so thrown errors propagate untouched.
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: Authorize };
  };
  return provider.options.authorize;
}

const baseUser = {
  id: "u1",
  email: "user@test.com",
  password: "hashed",
  firstName: "Jean",
  lastName: "Dupont",
  role: "CLIENT",
  company: "ACME",
};

describe("auth authorize — PENDING login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecurity.checkLoginLockout.mockResolvedValue(null);
    mockSecurity.recordLoginFailure.mockResolvedValue(undefined);
    mockSecurity.recordLoginSuccess.mockResolvedValue(undefined);
    mockBcrypt.compare.mockResolvedValue(true);
  });

  it("PENDING peut se connecter", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, status: "PENDING" });
    const authorize = getAuthorize();

    const result = (await authorize(
      { email: "user@test.com", password: "pw" },
      { headers: {} }
    )) as { id: string; status: string } | null;

    expect(result).not.toBeNull();
    expect(result?.id).toBe("u1");
    expect(result?.status).toBe("PENDING");
    expect(mockSecurity.recordLoginSuccess).toHaveBeenCalledOnce();
  });

  it("APPROVED peut se connecter", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, status: "APPROVED" });
    const authorize = getAuthorize();

    const result = (await authorize(
      { email: "user@test.com", password: "pw" },
      { headers: {} }
    )) as { status: string } | null;

    expect(result?.status).toBe("APPROVED");
  });

  it("REJECTED ne peut pas se connecter", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, status: "REJECTED" });
    const authorize = getAuthorize();

    await expect(
      authorize({ email: "user@test.com", password: "pw" }, { headers: {} })
    ).rejects.toThrow(/Identifiants incorrects/);
    expect(mockSecurity.recordLoginFailure).toHaveBeenCalledOnce();
  });

  it("mot de passe invalide → refusé même pour PENDING", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, status: "PENDING" });
    mockBcrypt.compare.mockResolvedValue(false);
    const authorize = getAuthorize();

    await expect(
      authorize({ email: "user@test.com", password: "bad" }, { headers: {} })
    ).rejects.toThrow(/Identifiants incorrects/);
  });
});
