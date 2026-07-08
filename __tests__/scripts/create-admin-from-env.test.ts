/**
 * Tests pour scripts/create-admin-from-env.ts — fonction ensureAdmin.
 * Verifie l'idempotence : ne recree pas d'admin si un existe deja, promeut si
 * l'email existe deja non-admin, cree sinon.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureAdmin } from "@/scripts/create-admin-from-env";

function makePrismaMock() {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
}

const fakeHash = vi.fn(async (plain: string) => `hashed:${plain}`);

describe("ensureAdmin", () => {
  beforeEach(() => {
    fakeHash.mockClear();
  });

  it("ne fait rien si un admin existe deja", async () => {
    const prisma = makePrismaMock();
    prisma.user.findFirst.mockResolvedValue({ email: "old-admin@example.com" });

    const result = await ensureAdmin(prisma, "new@example.com", "password123", fakeHash);

    expect(result).toEqual({ kind: "already-exists", email: "old-admin@example.com" });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(fakeHash).not.toHaveBeenCalled();
  });

  it("promeut un user existant non-admin en ADMIN + APPROVED", async () => {
    const prisma = makePrismaMock();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: "user-42" });
    prisma.user.update.mockResolvedValue({});

    const result = await ensureAdmin(prisma, " marie@shop.fr ", "password123", fakeHash);

    expect(result).toEqual({ kind: "promoted", email: "marie@shop.fr" });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: "marie@shop.fr" },
      data: { role: "ADMIN", status: "APPROVED" },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(fakeHash).not.toHaveBeenCalled();
  });

  it("cree un nouveau compte ADMIN + APPROVED avec bcrypt", async () => {
    const prisma = makePrismaMock();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({});

    const result = await ensureAdmin(prisma, "contact@shop.fr", "s3cretpwd", fakeHash);

    expect(result).toEqual({ kind: "created", email: "contact@shop.fr" });
    expect(fakeHash).toHaveBeenCalledWith("s3cretpwd");
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "contact@shop.fr",
        password: "hashed:s3cretpwd",
        role: "ADMIN",
        status: "APPROVED",
      }),
    });
  });

  it("rejette un email vide", async () => {
    const prisma = makePrismaMock();
    await expect(ensureAdmin(prisma, "   ", "password123", fakeHash)).rejects.toThrow(
      /ADMIN_EMAIL/,
    );
  });

  it("rejette un mot de passe trop court", async () => {
    const prisma = makePrismaMock();
    await expect(ensureAdmin(prisma, "a@b.fr", "12345", fakeHash)).rejects.toThrow(
      /caract/i,
    );
  });

  it("rejette un mot de passe vide", async () => {
    const prisma = makePrismaMock();
    await expect(ensureAdmin(prisma, "a@b.fr", "", fakeHash)).rejects.toThrow(
      /ADMIN_PASSWORD/,
    );
  });
});
