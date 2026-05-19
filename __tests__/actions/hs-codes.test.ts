import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hsCode: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
    },
  },
}));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { createHsCode, updateHsCode, deleteHsCode } from "@/app/actions/admin/hs-codes";

describe("createHsCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse un code vide", async () => {
    await expect(createHsCode({ code: "", label: "x" })).rejects.toThrow(
      "Le code SH est requis",
    );
  });

  it("refuse un code non numérique", async () => {
    await expect(createHsCode({ code: "ABC123", label: "x" })).rejects.toThrow(
      "uniquement des chiffres",
    );
  });

  it("refuse un code < 6 chiffres", async () => {
    await expect(createHsCode({ code: "12345", label: "x" })).rejects.toThrow(
      "6 à 10 chiffres",
    );
  });

  it("refuse un code > 10 chiffres", async () => {
    await expect(createHsCode({ code: "12345678901", label: "x" })).rejects.toThrow(
      "6 à 10 chiffres",
    );
  });

  it("refuse un libellé vide", async () => {
    await expect(createHsCode({ code: "7117190000", label: "  " })).rejects.toThrow(
      "Le libellé est requis",
    );
  });

  it("crée quand tout est valide", async () => {
    mockCreate.mockResolvedValue({ id: "abc", code: "7117190000", label: "Bijouterie" });
    const result = await createHsCode({ code: "7117190000", label: "Bijouterie fantaisie" });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { code: "7117190000", label: "Bijouterie fantaisie" },
    });
    expect(result).toEqual({
      success: true,
      id: "abc",
      code: "7117190000",
      label: "Bijouterie",
    });
  });

  it("rejette le doublon (P2002)", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(createHsCode({ code: "7117190000", label: "x" })).rejects.toThrow(
      "Ce code SH existe déjà",
    );
  });
});

describe("updateHsCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("met à jour code + libellé", async () => {
    mockUpdate.mockResolvedValue({ id: "abc" });
    await updateHsCode("abc", { code: "6204620000", label: "Pantalons" });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "abc" },
      data: { code: "6204620000", label: "Pantalons" },
    });
  });

  it("applique la même validation que create", async () => {
    await expect(updateHsCode("abc", { code: "12", label: "x" })).rejects.toThrow(
      "6 à 10 chiffres",
    );
  });
});

describe("deleteHsCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("supprime sans vérifier le count (SetNull cascade)", async () => {
    mockDelete.mockResolvedValue({ id: "abc" });
    const result = await deleteHsCode("abc");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "abc" } });
    expect(result).toEqual({ success: true });
  });
});
