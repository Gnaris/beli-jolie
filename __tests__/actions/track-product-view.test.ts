/**
 * Tests pour la server action `trackProductView` : vue produit, 1/jour/user/produit,
 * admin exclu, anonyme ignoré.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockCreateMany = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: mockGetSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    productView: { createMany: mockCreateMany },
  },
}));

import { trackProductView } from "@/app/actions/client/product-views";

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateMany.mockResolvedValue({ count: 1 });
});

describe("trackProductView", () => {
  it("ignore un visiteur anonyme", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await trackProductView("prod-1");

    expect(res).toEqual({ tracked: false });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("ignore un admin (ne gonfle pas les stats de la boutique)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });

    const res = await trackProductView("prod-1");

    expect(res).toEqual({ tracked: false });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("ignore un productId vide", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u-1", role: "CLIENT" },
    });

    const res = await trackProductView("");

    expect(res).toEqual({ tracked: false });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("insère la vue pour une cliente connectée (première vue du jour)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u-42", role: "CLIENT" },
    });

    const res = await trackProductView("prod-1");

    expect(res).toEqual({ tracked: true });
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const callArg = mockCreateMany.mock.calls[0][0];
    expect(callArg.skipDuplicates).toBe(true);
    expect(callArg.data[0].productId).toBe("prod-1");
    expect(callArg.data[0].userId).toBe("u-42");
    // viewedDate doit être une Date normalisée à 00:00 UTC
    const d: Date = callArg.data[0].viewedDate;
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("retourne tracked:false si la vue existe déjà aujourd'hui (count=0)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u-42", role: "CLIENT" },
    });
    mockCreateMany.mockResolvedValueOnce({ count: 0 });

    const res = await trackProductView("prod-1");

    expect(res).toEqual({ tracked: false });
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
  });
});
