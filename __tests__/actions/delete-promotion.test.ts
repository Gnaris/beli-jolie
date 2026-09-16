import { describe, it, expect, vi, beforeEach } from "vitest";

const { promotionDeleteSpy, revalidateTagSpy } = vi.hoisted(() => ({
  promotionDeleteSpy: vi.fn(),
  revalidateTagSpy: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    promotion: { delete: promotionDeleteSpy },
  },
}));
vi.mock("next/cache", () => ({ revalidateTag: revalidateTagSpy }));

import { deletePromotion } from "@/app/actions/admin/promotions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deletePromotion", () => {
  it("supprime la promo et invalide le cache", async () => {
    promotionDeleteSpy.mockResolvedValue({ id: "promo-1" });

    const result = await deletePromotion("promo-1");

    expect(result).toEqual({ success: true });
    expect(promotionDeleteSpy).toHaveBeenCalledWith({ where: { id: "promo-1" } });
    expect(revalidateTagSpy).toHaveBeenCalledWith("promotions", "default");
  });

  it("renvoie un message clair quand la promo n'existe plus (P2025)", async () => {
    const err = Object.assign(new Error("Record to delete does not exist."), {
      code: "P2025",
    });
    promotionDeleteSpy.mockRejectedValue(err);

    const result = await deletePromotion("ghost");

    expect(result.success).toBe(false);
    expect(result.error).toContain("n'existe plus");
    expect(revalidateTagSpy).not.toHaveBeenCalled();
  });

  it("renvoie un message générique sur autre erreur Prisma", async () => {
    promotionDeleteSpy.mockRejectedValue(new Error("Boom"));

    const result = await deletePromotion("promo-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Impossible de supprimer");
  });
});
