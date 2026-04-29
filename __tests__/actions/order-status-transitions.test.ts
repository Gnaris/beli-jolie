/**
 * Tests P2-01 — transitions de statut de commande.
 * On vérifie qu'on ne peut pas faire revenir une commande livrée en préparation,
 * ni ressusciter une commande annulée.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  order: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN" },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/notifications", () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/stock", () => ({
  reinstateStockForOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateOrderStatus } from "@/app/actions/admin/orders";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateOrderStatus — transitions autorisées (P2-01)", () => {
  const allowed: Array<[string, string]> = [
    ["PENDING", "PROCESSING"],
    ["PENDING", "CANCELLED"],
    ["PROCESSING", "SHIPPED"],
    ["PROCESSING", "CANCELLED"],
    ["SHIPPED", "DELIVERED"],
  ];

  for (const [from, to] of allowed) {
    it(`accepte ${from} → ${to}`, async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ status: from });
      await expect(updateOrderStatus("o1", to)).resolves.toBeUndefined();
      expect(mockPrisma.order.update).toHaveBeenCalledOnce();
    });
  }

  const forbidden: Array<[string, string]> = [
    ["DELIVERED", "PROCESSING"],
    ["DELIVERED", "PENDING"],
    ["CANCELLED", "PROCESSING"],
    ["SHIPPED", "PENDING"],
    ["PROCESSING", "PENDING"],
  ];

  for (const [from, to] of forbidden) {
    it(`refuse ${from} → ${to}`, async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ status: from });
      await expect(updateOrderStatus("o1", to)).rejects.toThrow(
        /Transition impossible/,
      );
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
  }

  it("idempotent — accepte de re-passer une commande au même statut sans rien changer", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ status: "DELIVERED" });
    await expect(updateOrderStatus("o1", "DELIVERED")).resolves.toBeUndefined();
  });

  it("refuse un statut inconnu", async () => {
    await expect(updateOrderStatus("o1", "FOO")).rejects.toThrow(/invalide/i);
  });

  it("refuse si la commande n'existe pas", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    await expect(updateOrderStatus("o1", "PROCESSING")).rejects.toThrow(
      /introuvable/,
    );
  });
});
