/**
 * Tests pour app/actions/admin/setUserAdminNote.ts
 *
 * Couvre : gating admin, refus des cibles ADMIN, validation longueur (max 2000),
 * trim + mise à null quand vide.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const { setUserAdminNote } = await import("@/app/actions/admin/setUserAdminNote");

const targetClient = { id: "user_1", role: "CLIENT" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setUserAdminNote", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await setUserAdminNote("user_1", "Note test");
    expect(res.success).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse un client (non admin)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const res = await setUserAdminNote("user_1", "Note test");
    expect(res.success).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse une cible inexistante", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const res = await setUserAdminNote("user_unknown", "Note");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/introuvable/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse la modification d'un compte ADMIN", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "admin_2", role: "ADMIN" });
    const res = await setUserAdminNote("admin_2", "Note");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/administrateur/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejette une note > 2000 caractères", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const huge = "z".repeat(2001);
    const res = await setUserAdminNote("user_1", huge);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/2000/);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("enregistre la note trimmée pour un admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce(targetClient);
    const res = await setUserAdminNote("user_1", "  Rappeler jeudi  ");
    expect(res.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: "user_1" });
    expect(arg.data).toEqual({ adminNote: "Rappeler jeudi" });
  });

  it("met adminNote à null quand la note est vide ou uniquement des espaces", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce(targetClient);
    const res = await setUserAdminNote("user_1", "   ");
    expect(res.success).toBe(true);
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data).toEqual({ adminNote: null });
  });

  it("revalide la page fiche client après sauvegarde", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce(targetClient);
    await setUserAdminNote("user_1", "Note");
    expect(mockRevalidate.revalidatePath).toHaveBeenCalledWith("/admin/clients/user_1");
  });
});
