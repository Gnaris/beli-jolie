/**
 * Tests pour app/actions/admin/updateClientProfile.ts
 *
 * Couvre l'unicité email/SIRET par tenant, le reset VIES sur changement TVA
 * et le refus des cibles ADMIN.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT_ID = "tenant_bj";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin_1", role: "ADMIN" } },
    tenant: { id: TENANT_ID, slug: "beliandjolie", name: "Beli & Jolie" },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { updateClientProfile } = await import("@/app/actions/admin/updateClientProfile");

const validData = {
  firstName: "Pascale",
  lastName: "Haller",
  email: "pascale@example.com",
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

const targetClient = {
  id: "user_1",
  email: "old@example.com",
  siret: "OLDSIRET1234",
  vatNumber: null,
  role: "CLIENT" as const,
};

describe("updateClientProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse une cible qui n'existe pas dans le tenant courant", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce(null); // target introuvable

    const res = await updateClientProfile("user_unknown", validData);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/introuvable/i);
  });

  it("refuse la modification d'un compte ADMIN", async () => {
    mockPrisma.user.findFirst.mockResolvedValueOnce({ ...targetClient, role: "ADMIN" });

    const res = await updateClientProfile("admin_2", validData);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/administrateur/i);
  });

  it("refuse un email déjà utilisé par un autre client du même tenant", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(targetClient) // load target
      .mockResolvedValueOnce({ id: "other_user" }); // dup email trouvé

    const res = await updateClientProfile("user_1", { ...validData, email: "already-taken@example.com" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/email.*déjà utilisé/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse un SIRET déjà utilisé par un autre client du même tenant", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(targetClient) // load target
      .mockResolvedValueOnce(null)          // email libre
      .mockResolvedValueOnce({ id: "other_user" }); // dup siret

    const res = await updateClientProfile("user_1", validData);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/SIRET.*déjà utilisé/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("update passe quand email/SIRET sont libres", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(targetClient)
      .mockResolvedValueOnce(null) // email libre
      .mockResolvedValueOnce(null); // siret libre

    const res = await updateClientProfile("user_1", validData);
    expect(res.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data.email).toBe("pascale@example.com");
    expect(arg.data.siret).toBe("12345678901234");
  });

  it("reset les flags VIES quand le N° TVA change", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce({ ...targetClient, vatNumber: "FR11111111111" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const res = await updateClientProfile("user_1", { ...validData, vatNumber: "FR22222222222" });
    expect(res.success).toBe(true);
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data.viesValid).toBeNull();
    expect(arg.data.viesRequestDate).toBeNull();
    expect(arg.data.vatExempt).toBe(false);
    expect(arg.data.vatValidatedAt).toBeNull();
    expect(arg.data.vatValidatedBy).toBeNull();
  });

  it("ne touche PAS aux flags VIES quand le N° TVA est identique", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce({ ...targetClient, vatNumber: "FR11111111111" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await updateClientProfile("user_1", { ...validData, vatNumber: "FR11111111111" });
    const arg = mockPrisma.user.update.mock.calls[0]![0];
    expect(arg.data.viesValid).toBeUndefined();
    expect(arg.data.vatExempt).toBeUndefined();
  });

  it("ne re-vérifie pas l'unicité si email inchangé", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(targetClient)
      .mockResolvedValueOnce(null); // siret libre

    const res = await updateClientProfile("user_1", { ...validData, email: targetClient.email });
    expect(res.success).toBe(true);
    // 2 calls seulement (load + siret check), pas de check email
    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it("refuse un email au format invalide (Zod)", async () => {
    const res = await updateClientProfile("user_1", { ...validData, email: "pas-un-email" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/email/i);
  });

  it("refuse un pays inconnu (Zod)", async () => {
    const res = await updateClientProfile("user_1", { ...validData, addressCountry: "ZZ" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/pays/i);
  });
});
