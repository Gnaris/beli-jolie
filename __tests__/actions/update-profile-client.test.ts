/**
 * Tests pour app/actions/client/profile.ts — updateProfile (côté client).
 *
 * Couvre l'unicité SIRET par tenant et le reset VIES sur changement TVA.
 * L'email n'est pas modifiable côté client (voir espace pro).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT_ID = "tenant_bj";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "user_1", role: "CLIENT" },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => mockSession),
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { updateProfile } = await import("@/app/actions/client/profile");

const validData = {
  firstName: "Pascale",
  lastName: "Haller",
  company: "Penalver",
  phone: "0682456789",
  siret: "12345678901234",
  vatNumber: "",
  addressStreet: "1 rue de la Paix",
  addressComplement: "",
  addressZip: "75002",
  addressCity: "Paris",
  addressCountry: "FR",
};

const currentUser = {
  id: "user_1",
  siret: "OLDSIRET1234",
  vatNumber: null,
  tenantId: TENANT_ID,
};

describe("updateProfile (client)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse un SIRET déjà utilisé par un autre client du même tenant", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: "other_user" });

    const res = await updateProfile(validData);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/SIRET.*déjà utilisé/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("update passe quand le SIRET est libre", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    const res = await updateProfile(validData);
    expect(res.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data.siret).toBe("12345678901234");
    expect(arg.data.addressCountry).toBe("FR");
  });

  it("reset les flags VIES quand le N° TVA change", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...currentUser,
      vatNumber: "FR11111111111",
    });
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    const res = await updateProfile({ ...validData, vatNumber: "FR22222222222" });
    expect(res.success).toBe(true);
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data.viesValid).toBeNull();
    expect(arg.data.vatExempt).toBe(false);
  });

  it("ne re-vérifie pas l'unicité SIRET si SIRET inchangé", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(currentUser);

    const res = await updateProfile({ ...validData, siret: currentUser.siret });
    expect(res.success).toBe(true);
    // 0 call findFirst car siret inchangé
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuse si la session est absente", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await updateProfile(validData);
    expect(res.success).toBe(false);
  });

  it("refuse un téléphone invalide (Zod)", async () => {
    const res = await updateProfile({ ...validData, phone: "abcdef" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/téléphone/i);
  });
});
