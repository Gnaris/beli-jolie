/**
 * Tests for lib/auth.ts JWT callback — révocation d'un utilisateur supprimé.
 *
 * NextAuth utilise une stratégie JWT (cookie signé, 30j). Sans re-vérification
 * périodique, un utilisateur supprimé en BDD conserverait une session valide.
 * Ce test couvre la re-vérification toutes les 30s + le flag `deleted`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/security", () => ({
  checkLoginLockout: vi.fn().mockResolvedValue(null),
  recordLoginFailure: vi.fn().mockResolvedValue(undefined),
  recordLoginSuccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/login-otp", () => ({ verifyLoginOtp: vi.fn() }));

import { authOptions } from "@/lib/auth";

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>;
type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>["session"]>;

function getJwtCallback(): JwtCallback {
  return authOptions.callbacks!.jwt!;
}

function getSessionCallback(): SessionCallback {
  return authOptions.callbacks!.session!;
}

function baseToken(overrides: Partial<JWT> = {}): JWT {
  return {
    id: "u1",
    role: "CLIENT",
    status: "APPROVED",
    company: "ACME",
    lastCheckedAt: Date.now(),
    deleted: false,
    ...overrides,
  } as JWT;
}

describe("auth jwt callback — révocation utilisateur supprimé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-vérifie en BDD et marque token.deleted=true si user introuvable", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const jwt = getJwtCallback();

    // Token vieux de plus de 30s pour forcer la re-vérification
    const oldToken = baseToken({ lastCheckedAt: Date.now() - 60_000 });
    const result = (await jwt({
      token: oldToken,
      user: undefined as never,
      account: null,
      trigger: undefined,
    } as Parameters<JwtCallback>[0])) as JWT;

    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce();
    expect(result.deleted).toBe(true);
  });

  it("ne re-vérifie pas dans la fenêtre 30s (perf)", async () => {
    const jwt = getJwtCallback();
    const freshToken = baseToken({ lastCheckedAt: Date.now() - 5_000 });

    await jwt({
      token: freshToken,
      user: undefined as never,
      account: null,
      trigger: undefined,
    } as Parameters<JwtCallback>[0]);

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("ne ressuscite pas un token déjà marqué deleted", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      status: "APPROVED",
      role: "CLIENT",
      company: "ACME",
    });
    const jwt = getJwtCallback();
    const deletedToken = baseToken({
      deleted: true,
      lastCheckedAt: Date.now() - 60_000,
    });

    const result = (await jwt({
      token: deletedToken,
      user: undefined as never,
      account: null,
      trigger: undefined,
    } as Parameters<JwtCallback>[0])) as JWT;

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(result.deleted).toBe(true);
  });

  it("force la re-vérif sur trigger='update' même dans la fenêtre 30s", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      status: "APPROVED",
      role: "CLIENT",
      company: "NEW",
    });
    const jwt = getJwtCallback();
    const freshToken = baseToken({ lastCheckedAt: Date.now() - 5_000 });

    const result = (await jwt({
      token: freshToken,
      user: undefined as never,
      account: null,
      trigger: "update",
    } as Parameters<JwtCallback>[0])) as JWT;

    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce();
    expect(result.company).toBe("NEW");
    expect(result.deleted).toBe(false);
  });

  it("erreur BDD : NE déconnecte PAS (filet de sécurité)", async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error("DB down"));
    const jwt = getJwtCallback();
    const oldToken = baseToken({ lastCheckedAt: Date.now() - 60_000 });

    const result = (await jwt({
      token: oldToken,
      user: undefined as never,
      account: null,
      trigger: undefined,
    } as Parameters<JwtCallback>[0])) as JWT;

    expect(result.deleted).toBe(false);
    expect(result.id).toBe("u1");
  });

  it("met à jour role/status/company depuis la BDD quand user existe", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      status: "PENDING",
      role: "ADMIN",
      company: "BJ",
    });
    const jwt = getJwtCallback();
    const oldToken = baseToken({
      lastCheckedAt: Date.now() - 60_000,
      role: "CLIENT",
      status: "APPROVED",
      company: "OLD",
    });

    const result = (await jwt({
      token: oldToken,
      user: undefined as never,
      account: null,
      trigger: undefined,
    } as Parameters<JwtCallback>[0])) as JWT;

    expect(result.role).toBe("ADMIN");
    expect(result.status).toBe("PENDING");
    expect(result.company).toBe("BJ");
    expect(result.deleted).toBe(false);
  });
});

describe("auth session callback — sentinelle pour token supprimé", () => {
  it("token.deleted=true → user sentinelle (CLIENT + REJECTED, id vide)", async () => {
    const sessionCb = getSessionCallback();
    const result = (await sessionCb({
      session: { user: { id: "u1", email: "x", name: "y", role: "ADMIN", status: "APPROVED", company: "ACME" }, expires: "2099-01-01" },
      token: baseToken({ deleted: true }),
    } as Parameters<SessionCallback>[0])) as { user: { id: string; role: string; status: string } };

    expect(result.user.id).toBe("");
    expect(result.user.role).toBe("CLIENT");
    expect(result.user.status).toBe("REJECTED");
  });

  it("token non supprimé → propagation normale des champs", async () => {
    const sessionCb = getSessionCallback();
    const result = (await sessionCb({
      session: { user: { id: "", email: "x", name: "y", role: "CLIENT", status: "APPROVED", company: "" }, expires: "2099-01-01" },
      token: baseToken({ id: "u42", role: "ADMIN", status: "APPROVED", company: "BJ" }),
    } as Parameters<SessionCallback>[0])) as { user: { id: string; role: string; company: string } };

    expect(result.user.id).toBe("u42");
    expect(result.user.role).toBe("ADMIN");
    expect(result.user.company).toBe("BJ");
  });
});
