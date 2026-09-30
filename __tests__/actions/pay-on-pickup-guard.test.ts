/**
 * Garde-fou serveur : le flag `_payOnPickupMode` de placeBankTransferOrder
 * n'est autorisé qu'en mode retrait boutique. Empêche un client de contourner
 * l'UI pour « commander sans payer » en livraison classique.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  order: { findFirst: vi.fn() },
  productColor: { findMany: vi.fn() },
  productColorImage: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "user-1", role: "CLIENT", status: "APPROVED" },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/bank-transfer-config", () => ({
  getCachedBankTransferConfig: vi.fn().mockResolvedValue({ enabled: true, holder: "", iban: "" }),
}));
vi.mock("@/lib/notifications", () => ({
  notifyAdminNewOrder: vi.fn().mockResolvedValue(undefined),
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  getCurrentTenantSlug: vi.fn().mockResolvedValue("beliandjolie"),
}));
vi.mock("@/lib/abandoned-cart-trigger", () => ({
  cancelAbandonedCartJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  // Un burst d'appels doit passer les guards initiaux — on autorise.
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));

import { placeBankTransferOrder } from "@/app/actions/client/bank-transfer-order";

beforeEach(() => {
  vi.clearAllMocks();
  // Sécurité : aucun test ci-dessous ne doit toucher la BDD — si un scénario
  // atteint la lecture panier, on le veut visible et non un mock silencieux.
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.cart.findUnique.mockResolvedValue(null);
});

describe("placeBankTransferOrder — flag _payOnPickupMode", () => {
  it("refuse le paiement sur place si deliveryMode !== 'pickup' (livraison classique)", async () => {
    const result = await placeBankTransferOrder({
      addressId: "addr-1",
      deliveryMode: "delivery",
      carrierId: "test-carrier",
      transactionId: "tx-1",
      carrierSig: "sig-1",
      carrierName: "Test carrier",
      carrierPrice: 10,
      _payOnPickupMode: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/retrait en boutique/i);
    }
    // Ne doit même pas atteindre le chargement de l'utilisateur / panier.
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it("refuse le paiement sur place en mode 'private' (transporteur privé)", async () => {
    const result = await placeBankTransferOrder({
      addressId: "addr-1",
      deliveryMode: "private",
      carrierId: "private_carrier",
      transactionId: "tx-2",
      carrierSig: "sig-2",
      carrierName: "Transporteur privé",
      carrierPrice: 0,
      _payOnPickupMode: true,
    });

    expect(result.success).toBe(false);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuse le paiement sur place en mode 'merge' (fusion commande)", async () => {
    const result = await placeBankTransferOrder({
      addressId: "addr-1",
      deliveryMode: "merge",
      carrierId: "merge_into_order",
      transactionId: "tx-3",
      carrierSig: "sig-3",
      carrierName: "Fusion",
      carrierPrice: 0,
      mergeIntoOrderId: "parent-order-id",
      _payOnPickupMode: true,
    });

    expect(result.success).toBe(false);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("laisse passer la garde deliveryMode pour un retrait boutique (le refus vient plus tard côté BDD)", async () => {
    // En mode pickup, le guard précoce ne déclenche pas — on progresse jusqu'au
    // chargement utilisateur (qui échoue ici car mocké à null).
    const result = await placeBankTransferOrder({
      addressId: undefined, // retrait : pas d'adresse requise
      deliveryMode: "pickup",
      carrierId: "pickup_store",
      transactionId: "tx-4",
      carrierSig: "sig-4",
      carrierName: "Retrait boutique",
      carrierPrice: 0,
      _payOnPickupMode: true,
    });

    // Le refus vient de "Votre compte est introuvable" (user mocké à null),
    // ce qui prouve que le guard deliveryMode a bien laissé passer.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toMatch(/retrait en boutique/i);
    }
    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce();
  });
});
