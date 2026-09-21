/**
 * Tests pour app/actions/client/change-email.ts.
 *
 * Couvre :
 *  - refus si session absente
 *  - refus si mot de passe incorrect
 *  - refus si email déjà pris par un autre user du même tenant
 *  - refus si nouvel email identique à l'actuel
 *  - flow nominal : token créé + 2 mails envoyés
 *  - confirmation : token invalide/expiré/déjà utilisé
 *  - confirmation nominale : email basculé + token consommé
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  emailChangeToken: {
    updateMany: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  $transaction: vi.fn(async (ops: unknown[]) => ops.map(() => ({}))),
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "user_1", role: "CLIENT" },
}));

const mockBcrypt = vi.hoisted(() => ({
  compare: vi.fn(),
}));

const mockRateLimit = vi.hoisted(() => vi.fn(() => ({ success: true, remaining: 4 })));

const mockCreate = vi.hoisted(() => vi.fn(async () => ({ token: "tok_abc", expiresAt: new Date() })));
const mockSendConfirm = vi.hoisted(() => vi.fn(async () => {}));
const mockSendNotice = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("bcryptjs", () => ({ default: mockBcrypt, ...mockBcrypt }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/email-change", () => ({
  createEmailChangeToken: mockCreate,
  sendEmailChangeConfirmationEmail: mockSendConfirm,
  sendEmailChangeNoticeToOldEmail: mockSendNotice,
}));

const { requestEmailChange, confirmEmailChange } = await import(
  "@/app/actions/client/change-email"
);

const currentUser = {
  id: "user_1",
  email: "old@example.com",
  password: "hashed",
  tenantId: "tenant_bj",
};

describe("requestEmailChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockReturnValue({ success: true, remaining: 4 });
    mockBcrypt.compare.mockResolvedValue(true);
  });

  it("refuse si session absente", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await requestEmailChange({
      newEmail: "new@example.com",
      currentPassword: "secret",
    });
    expect(res.success).toBe(false);
  });

  it("refuse email invalide (Zod)", async () => {
    const res = await requestEmailChange({
      newEmail: "pas-un-email",
      currentPassword: "secret",
    });
    expect(res.success).toBe(false);
  });

  it("refuse si le nouvel email est identique à l'actuel", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    const res = await requestEmailChange({
      newEmail: "old@example.com",
      currentPassword: "secret",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/déjà le vôtre/i);
  });

  it("refuse si mot de passe incorrect", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    mockBcrypt.compare.mockResolvedValueOnce(false);
    const res = await requestEmailChange({
      newEmail: "new@example.com",
      currentPassword: "wrong",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/mot de passe/i);
  });

  it("refuse si email déjà pris par un autre user", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: "other" });
    const res = await requestEmailChange({
      newEmail: "new@example.com",
      currentPassword: "secret",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/déjà utilisé/i);
  });

  it("flow nominal : token créé + 2 mails envoyés", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);
    const res = await requestEmailChange({
      newEmail: "new@example.com",
      currentPassword: "secret",
    });
    expect(res.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      userId: "user_1",
      oldEmail: "old@example.com",
      newEmail: "new@example.com",
    });
    expect(mockSendConfirm).toHaveBeenCalledOnce();
    expect(mockSendNotice).toHaveBeenCalledOnce();
  });

  it("bloque si le rate limit est dépassé", async () => {
    mockRateLimit.mockReturnValueOnce({ success: false, remaining: 0 });
    const res = await requestEmailChange({
      newEmail: "new@example.com",
      currentPassword: "secret",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/tentatives/i);
  });
});

describe("confirmEmailChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse un token vide", async () => {
    const res = await confirmEmailChange("");
    expect(res.success).toBe(false);
  });

  it("refuse un token inconnu", async () => {
    mockPrisma.emailChangeToken.findUnique.mockResolvedValueOnce(null);
    const res = await confirmEmailChange("bad");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/invalide|expiré/i);
  });

  it("refuse un token déjà utilisé", async () => {
    mockPrisma.emailChangeToken.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      newEmail: "new@example.com",
      token: "tok",
      used: true,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await confirmEmailChange("tok");
    expect(res.success).toBe(false);
  });

  it("refuse un token expiré", async () => {
    mockPrisma.emailChangeToken.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      newEmail: "new@example.com",
      token: "tok",
      used: false,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await confirmEmailChange("tok");
    expect(res.success).toBe(false);
  });

  it("refuse si le nouvel email a été pris entre-temps", async () => {
    mockPrisma.emailChangeToken.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      newEmail: "new@example.com",
      token: "tok",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: "other" });
    const res = await confirmEmailChange("tok");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/pris|contactez/i);
    expect(mockPrisma.emailChangeToken.update).toHaveBeenCalled();
  });

  it("flow nominal : email basculé + token consommé", async () => {
    mockPrisma.emailChangeToken.findUnique.mockResolvedValueOnce({
      userId: "user_1",
      newEmail: "new@example.com",
      token: "tok",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);
    const res = await confirmEmailChange("tok");
    expect(res.success).toBe(true);
    if (res.success) expect(res.newEmail).toBe("new@example.com");
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});
