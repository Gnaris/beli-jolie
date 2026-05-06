/**
 * Tests des server actions admin pour la gestion du bordereau d'expédition :
 *   - generateShipmentLabel  : recotation Easy-Express + checkout
 *   - setManualShipping       : saisie manuelle du suivi
 *   - clearShipping           : effacement du suivi
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  order: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  orderItem: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "ADMIN" },
}));

const mockEasyExpress = vi.hoisted(() => ({
  fetchEasyExpressRates: vi.fn(),
  createEasyExpressShipment: vi.fn(),
  splitWeightIntoParcels: vi.fn().mockReturnValue([{ weight: 1 }]),
  MAX_PARCEL_WEIGHT_KG: 25,
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/easy-express", () => mockEasyExpress);
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  generateShipmentLabel,
  setManualShipping,
  clearShipping,
} from "@/app/actions/admin/shipping";

const FAKE_ORDER = {
  id: "o1",
  orderNumber: "ABC123",
  carrierName: "FedEx International",
  shipFirstName: "Jane",
  shipLastName: "Doe",
  shipCompany: null,
  shipAddress1: "123 Main St",
  shipAddress2: null,
  shipZipCode: "10001",
  shipCity: "New York",
  shipCountry: "US",
  clientEmail: "jane@example.com",
  clientPhone: "+33600000000",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.order.findUnique.mockResolvedValue(FAKE_ORDER);
  mockPrisma.order.update.mockResolvedValue({});
  mockPrisma.orderItem.findMany.mockResolvedValue([
    {
      quantity: 1,
      variantSnapshot: JSON.stringify({ weight: 0.5, saleType: "UNIT" }),
    },
  ]);
});

describe("generateShipmentLabel", () => {
  it("appelle Easy-Express et stocke le bordereau quand le carrier match par nom", async () => {
    mockEasyExpress.fetchEasyExpressRates.mockResolvedValue({
      success: true,
      transactionId: "tx-1",
      carriers: [
        { carrierId: "cid-fedex", name: "FedEx International", price: 30, delay: "3 j", logo: "" },
        { carrierId: "cid-ups",   name: "UPS Express",         price: 35, delay: "2 j", logo: "" },
      ],
    });
    mockEasyExpress.createEasyExpressShipment.mockResolvedValue({
      success: true,
      trackingId: "TR-123",
      labelUrl: "https://easy-express.fr/label/abc.pdf",
    });

    const res = await generateShipmentLabel("o1");

    expect(res.success).toBe(true);
    expect(res.trackingId).toBe("TR-123");
    expect(res.labelUrl).toBe("https://easy-express.fr/label/abc.pdf");
    expect(mockEasyExpress.createEasyExpressShipment).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-1", carrierId: "cid-fedex" }),
    );
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { eeTrackingId: "TR-123", eeLabelUrl: "https://easy-express.fr/label/abc.pdf" },
    });
  });

  it("renvoie la liste des transporteurs disponibles si le nom d'origine n'existe plus", async () => {
    mockEasyExpress.fetchEasyExpressRates.mockResolvedValue({
      success: true,
      transactionId: "tx-2",
      carriers: [
        { carrierId: "cid-ups", name: "UPS Express", price: 35, delay: "2 j", logo: "" },
      ],
    });

    const res = await generateShipmentLabel("o1");

    expect(res.success).toBe(false);
    expect(res.availableCarriers).toHaveLength(1);
    expect(res.availableCarriers?.[0].name).toBe("UPS Express");
    expect(res.transactionId).toBe("tx-2");
    expect(mockEasyExpress.createEasyExpressShipment).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("utilise l'override (carrierId + transactionId) sans refaire de cotation", async () => {
    mockEasyExpress.createEasyExpressShipment.mockResolvedValue({
      success: true,
      trackingId: "TR-OVR",
      labelUrl: "https://easy-express.fr/label/ovr.pdf",
    });

    const res = await generateShipmentLabel("o1", {
      carrierId: "cid-chrono",
      transactionId: "tx-override",
    });

    expect(res.success).toBe(true);
    expect(mockEasyExpress.fetchEasyExpressRates).not.toHaveBeenCalled();
    expect(mockEasyExpress.createEasyExpressShipment).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-override", carrierId: "cid-chrono" }),
    );
  });

  it("retourne une erreur si la cotation échoue", async () => {
    mockEasyExpress.fetchEasyExpressRates.mockResolvedValue({
      success: false,
      error: "Easy-Express rates: 500",
    });

    const res = await generateShipmentLabel("o1");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Easy-Express/);
  });

  it("retourne une erreur si la commande est introuvable", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await generateShipmentLabel("o1");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/introuvable/i);
  });

  it("rejette les non-admins", async () => {
    const nextAuth = await import("next-auth");
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce({
      user: { id: "u1", role: "CLIENT" },
    } as never);

    await expect(generateShipmentLabel("o1")).rejects.toThrow(/non autorisé/i);
  });
});

describe("setManualShipping", () => {
  it("sauvegarde transporteur + suivi et efface eeLabelUrl", async () => {
    const res = await setManualShipping("o1", {
      carrierName: "  Chronopost  ",
      trackingId: "  CH123  ",
    });

    expect(res.success).toBe(true);
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { carrierName: "Chronopost", eeTrackingId: "CH123", eeLabelUrl: null },
    });
  });

  it("refuse les champs vides", async () => {
    const res1 = await setManualShipping("o1", { carrierName: "", trackingId: "T" });
    expect(res1.success).toBe(false);
    expect(res1.error).toMatch(/transporteur/i);

    const res2 = await setManualShipping("o1", { carrierName: "FedEx", trackingId: "  " });
    expect(res2.success).toBe(false);
    expect(res2.error).toMatch(/suivi/i);

    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("retourne une erreur si la commande est introuvable", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await setManualShipping("o1", { carrierName: "FedEx", trackingId: "T" });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/introuvable/i);
  });

  it("rejette les non-admins", async () => {
    const nextAuth = await import("next-auth");
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce(null);

    await expect(
      setManualShipping("o1", { carrierName: "FedEx", trackingId: "T" }),
    ).rejects.toThrow(/non autorisé/i);
  });
});

describe("clearShipping", () => {
  it("met à null le suivi et le bordereau", async () => {
    const res = await clearShipping("o1");

    expect(res.success).toBe(true);
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { eeTrackingId: null, eeLabelUrl: null },
    });
  });

  it("retourne une erreur si la commande est introuvable", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await clearShipping("o1");

    expect(res.success).toBe(false);
  });
});
