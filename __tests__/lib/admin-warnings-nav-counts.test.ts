/**
 * Vérifie que `fetchAdminWarnings` remonte bien les compteurs affichés
 * dans la barre de navigation admin :
 *   - pendingOrdersCount  (Commandes)
 *   - pendingUsersCount   (Clients — inscriptions non traitées)
 *   - openClaimsCount     (Service Client — SAV ouverts)
 *   - pendingReviewsCount (Avis — modération en attente)
 *
 * Ces compteurs alimentent le petit rond bleu affiché à côté du libellé
 * de menu. Depuis 2026-10-06 ils sont lus en LIVE (plus de cache 5 min)
 * puis rafraîchis côté navigateur toutes les ~25 s via
 * `LiveAdminWarningsProvider`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  product: { count: vi.fn() },
  color: { count: vi.fn() },
  composition: { count: vi.fn() },
  tag: { count: vi.fn() },
  category: { count: vi.fn() },
  subCategory: { count: vi.fn() },
  order: { count: vi.fn() },
  user: { count: vi.fn() },
  claim: { count: vi.fn() },
  customerReview: { count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { fetchAdminWarnings } from "@/lib/admin-warnings";

describe("fetchAdminWarnings — compteurs navigation admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.color.count.mockResolvedValue(0);
    mockPrisma.composition.count.mockResolvedValue(0);
    mockPrisma.tag.count.mockResolvedValue(0);
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.subCategory.count.mockResolvedValue(0);
    mockPrisma.order.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.claim.count.mockResolvedValue(0);
    mockPrisma.customerReview.count.mockResolvedValue(0);
  });

  it("remonte pendingUsersCount depuis prisma.user.count(status=PENDING, role=CLIENT)", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(4);

    const res = await fetchAdminWarnings();

    expect(res.pendingUsersCount).toBe(4);
    expect(mockPrisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "CLIENT", status: "PENDING" }),
      }),
    );
  });

  it("remonte openClaimsCount depuis prisma.claim.count(status=OPEN)", async () => {
    mockPrisma.claim.count.mockResolvedValueOnce(2);

    const res = await fetchAdminWarnings();

    expect(res.openClaimsCount).toBe(2);
    expect(mockPrisma.claim.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "OPEN" }),
      }),
    );
  });

  it("remonte pendingOrdersCount depuis prisma.order.count(status=PENDING)", async () => {
    mockPrisma.order.count.mockResolvedValueOnce(7);

    const res = await fetchAdminWarnings();

    expect(res.pendingOrdersCount).toBe(7);
    expect(mockPrisma.order.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("remonte pendingReviewsCount depuis prisma.customerReview.count(status=PENDING)", async () => {
    mockPrisma.customerReview.count.mockResolvedValueOnce(3);

    const res = await fetchAdminWarnings();

    expect(res.pendingReviewsCount).toBe(3);
    expect(mockPrisma.customerReview.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("remonte 0 pour chaque compteur si aucune ligne en base", async () => {
    const res = await fetchAdminWarnings();

    expect(res.pendingOrdersCount).toBe(0);
    expect(res.pendingUsersCount).toBe(0);
    expect(res.openClaimsCount).toBe(0);
    expect(res.pendingReviewsCount).toBe(0);
    expect(res.untranslatedCount).toBe(0);
  });
});
