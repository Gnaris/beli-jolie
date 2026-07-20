import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminClientCard: {
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
    },
  },
}));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({ id: "tenant-1", slug: "beli-jolie", name: "Beli & Jolie" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  createAdminClientCard,
  updateAdminClientCard,
  deleteAdminClientCard,
} from "@/app/actions/admin/admin-client-cards";

const baseInput = {
  firstName: "Marie",
  lastName: "Lambert",
  company: "Boutique Étoile",
  siret: null,
  vatNumber: null,
  email: null,
  phone: null,
  website: null,
  addressLine: null,
  postalCode: null,
  city: null,
  countryCode: null,
  hasPfs: true,
  hasAnkorstore: false,
  hasEfashion: false,
  hasFaire: false,
  hasMicrostore: true,
  hasPassage: false,
  lastOrderAt: null,
  lastMessageSentAt: null,
  orderDiscountType: null,
  orderDiscountValue: null,
  shippingFree: false,
  shippingDiscountType: null,
  shippingDiscountValue: null,
  note: null,
};

describe("createAdminClientCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse quand le prénom est vide", async () => {
    await expect(
      createAdminClientCard({ ...baseInput, firstName: "" }),
    ).rejects.toThrow(/prénom/i);
  });

  it("refuse quand le nom est vide", async () => {
    await expect(
      createAdminClientCard({ ...baseInput, lastName: "  " }),
    ).rejects.toThrow(/nom/i);
  });

  it("crée avec identité + marketplaces + tenant + admin", async () => {
    mockCreate.mockResolvedValue({ id: "card-1" });
    const result = await createAdminClientCard(baseInput);
    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.firstName).toBe("Marie");
    expect(arg.data.lastName).toBe("Lambert");
    expect(arg.data.hasPfs).toBe(true);
    expect(arg.data.hasMicrostore).toBe(true);
    expect(arg.data.hasPassage).toBe(false);
    expect(arg.data.hasAnkorstore).toBe(false);
    expect(arg.data.createdById).toBe("admin-1");
    expect(arg.data.tenantId).toBe("tenant-1");
    expect(result).toEqual({ success: true, id: "card-1" });
  });

  it("nettoie les valeurs de remise quand désactivées", async () => {
    mockCreate.mockResolvedValue({ id: "card-2" });
    await createAdminClientCard({
      ...baseInput,
      orderDiscountType: null,
      orderDiscountValue: 10,
      shippingFree: false,
      shippingDiscountType: null,
      shippingDiscountValue: 5,
    });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.orderDiscountType).toBeNull();
    expect(arg.data.orderDiscountValue).toBeNull();
    expect(arg.data.shippingDiscountType).toBeNull();
    expect(arg.data.shippingDiscountValue).toBeNull();
    expect(arg.data.shippingFree).toBe(false);
  });

  it("conserve type + valeur quand la remise commande est active en %", async () => {
    mockCreate.mockResolvedValue({ id: "card-3" });
    await createAdminClientCard({
      ...baseInput,
      orderDiscountType: "PERCENT",
      orderDiscountValue: 10,
    });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.orderDiscountType).toBe("PERCENT");
    expect(arg.data.orderDiscountValue).toBe(10);
  });

  it("force livraison offerte : type et valeur à null", async () => {
    mockCreate.mockResolvedValue({ id: "card-4" });
    await createAdminClientCard({
      ...baseInput,
      shippingFree: true,
      shippingDiscountType: "PERCENT",
      shippingDiscountValue: 50,
    });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.shippingFree).toBe(true);
    expect(arg.data.shippingDiscountType).toBeNull();
    expect(arg.data.shippingDiscountValue).toBeNull();
  });

  it("refuse un email invalide (mais accepte email null)", async () => {
    mockCreate.mockResolvedValue({ id: "x" });
    await expect(
      createAdminClientCard({ ...baseInput, email: "pas-un-email" }),
    ).rejects.toThrow(/email/i);
  });

  it("accepte email null", async () => {
    mockCreate.mockResolvedValue({ id: "card-5" });
    await createAdminClientCard({ ...baseInput, email: null });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("enregistre hasPassage à true quand le client vient en boutique", async () => {
    mockCreate.mockResolvedValue({ id: "card-passage" });
    await createAdminClientCard({ ...baseInput, hasPassage: true });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.hasPassage).toBe(true);
  });

  it("parse la date dernière commande depuis un string ISO date", async () => {
    mockCreate.mockResolvedValue({ id: "card-6" });
    await createAdminClientCard({ ...baseInput, lastOrderAt: "2026-07-14" });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.lastOrderAt).toBeInstanceOf(Date);
  });

  it("enregistre les 4 champs d'adresse structurée", async () => {
    mockCreate.mockResolvedValue({ id: "card-addr" });
    await createAdminClientCard({
      ...baseInput,
      addressLine: "12 rue des Lilas",
      postalCode: "75001",
      city: "Paris",
      countryCode: "FR",
    });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.addressLine).toBe("12 rue des Lilas");
    expect(arg.data.postalCode).toBe("75001");
    expect(arg.data.city).toBe("Paris");
    expect(arg.data.countryCode).toBe("FR");
  });

  it("normalise le code pays en majuscules", async () => {
    mockCreate.mockResolvedValue({ id: "card-lc" });
    await createAdminClientCard({ ...baseInput, countryCode: "be" });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.countryCode).toBe("BE");
  });

  it("refuse un code pays inconnu", async () => {
    await expect(
      createAdminClientCard({ ...baseInput, countryCode: "ZZ" }),
    ).rejects.toThrow(/pays/i);
  });

  it("accepte countryCode null (pays non renseigné)", async () => {
    mockCreate.mockResolvedValue({ id: "card-nocountry" });
    await createAdminClientCard({ ...baseInput, countryCode: null });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.data.countryCode).toBeNull();
  });
});

describe("updateAdminClientCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse si la fiche n'existe pas", async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(updateAdminClientCard("nope", baseInput)).rejects.toThrow(/introuvable/i);
  });

  it("met à jour les champs quand la fiche existe", async () => {
    mockFindFirst.mockResolvedValue({ id: "card-1" });
    mockUpdate.mockResolvedValue({});
    const result = await updateAdminClientCard("card-1", { ...baseInput, note: "VIP client" });
    expect(mockUpdate).toHaveBeenCalledOnce();
    const arg = mockUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "card-1" });
    expect(arg.data.note).toBe("VIP client");
    expect(result).toEqual({ success: true });
  });
});

describe("deleteAdminClientCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse si la fiche n'existe pas", async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(deleteAdminClientCard("nope")).rejects.toThrow(/introuvable/i);
  });

  it("supprime quand la fiche existe", async () => {
    mockFindFirst.mockResolvedValue({ id: "card-1" });
    mockDelete.mockResolvedValue({});
    const result = await deleteAdminClientCard("card-1");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "card-1" } });
    expect(result).toEqual({ success: true });
  });
});

describe("requireAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse quand la session est absente", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(createAdminClientCard(baseInput)).rejects.toThrow(/non autorisé/i);
  });

  it("refuse quand le rôle n'est pas ADMIN", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "u1", role: "CLIENT" },
    });
    await expect(createAdminClientCard(baseInput)).rejects.toThrow(/non autorisé/i);
  });
});
