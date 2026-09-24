/**
 * Tests pour createClaim() étendu par le wizard Service Client (2026-09-24) :
 * validation des flux ORDER_RELATED et OTHER, refus des quantités invalides,
 * scoping par utilisateur.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockOrderFindFirst = vi.hoisted(() => vi.fn());
const mockOrderFindUnique = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockClaimCreate = vi.hoisted(() => vi.fn());
const mockMessageCreate = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: mockGetSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: mockOrderFindFirst, findUnique: mockOrderFindUnique },
    user: { findUnique: mockUserFindUnique },
    claim: { create: mockClaimCreate, findFirst: vi.fn() },
    message: { create: mockMessageCreate, updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/claims", () => ({
  generateClaimReference: vi.fn().mockResolvedValue("REF-TEST-001"),
  CLAIMS_PAGE_SIZE: 20,
}));
vi.mock("@/lib/messaging", () => ({
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  addMessage: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  notifyAdminNewClaim: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/support-notify", () => ({ cancelPendingNotifications: vi.fn() }));
vi.mock("@/lib/chat-events", () => ({ emitChatEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { createClaim } from "@/app/actions/client/claims";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    user: { id: "u-approved", role: "CLIENT", status: "APPROVED" },
  });
  mockUserFindUnique.mockResolvedValue({
    firstName: "Jane", lastName: "Doe", company: "Acme", email: "jane@acme.test",
  });
  mockClaimCreate.mockResolvedValue({ id: "claim-1" });
  mockOrderFindUnique.mockResolvedValue({
    orderNumber: "AB12CD34",
    items: [],
  });
});

describe("createClaim — validation flux ORDER_RELATED", () => {
  it("refuse ORDER_RELATED sans orderId", async () => {
    const res = await createClaim({
      subject: "Test",
      message: "Message",
      type: "ORDER_RELATED",
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/commande manquante/i);
  });

  it("refuse ORDER_RELATED avec commande qui n'appartient pas au client", async () => {
    mockOrderFindFirst.mockResolvedValue(null);
    const res = await createClaim({
      subject: "Test",
      message: "Message",
      type: "ORDER_RELATED",
      orderId: "order-other-user",
      orderItems: [{ orderItemId: "it-1", quantity: 1 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/commande introuvable/i);
  });

  it("refuse quand toutes les quantités sont à 0", async () => {
    mockOrderFindFirst.mockResolvedValue({
      id: "order-1",
      items: [{ id: "it-1", quantity: 3 }, { id: "it-2", quantity: 2 }],
    });
    const res = await createClaim({
      subject: "Test",
      message: "Message",
      type: "ORDER_RELATED",
      orderId: "order-1",
      orderItems: [
        { orderItemId: "it-1", quantity: 0 },
        { orderItemId: "it-2", quantity: 0 },
      ],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sélectionnez au moins une quantité/i);
  });

  it("refuse quand une quantité dépasse celle commandée", async () => {
    mockOrderFindFirst.mockResolvedValue({
      id: "order-1",
      items: [{ id: "it-1", quantity: 3 }],
    });
    const res = await createClaim({
      subject: "Test",
      message: "Message",
      type: "ORDER_RELATED",
      orderId: "order-1",
      orderItems: [{ orderItemId: "it-1", quantity: 5 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/supérieure/i);
  });

  it("refuse quand un orderItemId n'appartient pas à la commande", async () => {
    mockOrderFindFirst.mockResolvedValue({
      id: "order-1",
      items: [{ id: "it-1", quantity: 3 }],
    });
    const res = await createClaim({
      subject: "Test",
      message: "Message",
      type: "ORDER_RELATED",
      orderId: "order-1",
      orderItems: [{ orderItemId: "it-inexistant", quantity: 1 }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/introuvable/i);
  });

  it("accepte un flux ORDER_RELATED valide et crée le claim avec les items", async () => {
    mockOrderFindFirst.mockResolvedValue({
      id: "order-1",
      items: [{ id: "it-1", quantity: 3 }, { id: "it-2", quantity: 5 }],
    });
    const res = await createClaim({
      subject: "Colis abîmé",
      message: "Deux articles reçus cassés",
      type: "ORDER_RELATED",
      orderId: "order-1",
      orderItems: [
        { orderItemId: "it-1", quantity: 2 },
        { orderItemId: "it-2", quantity: 0 }, // ignoré
      ],
    });
    expect(res.success).toBe(true);
    expect(mockClaimCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ORDER_RELATED",
          orderId: "order-1",
          orderItems: {
            create: [{ orderItemId: "it-1", quantity: 2 }],
          },
        }),
      }),
    );
  });
});

describe("createClaim — flux OTHER (défaut)", () => {
  it("crée un claim OTHER sans orderId ni items", async () => {
    const res = await createClaim({
      subject: "Question tarif",
      message: "Est-ce que vous faites du gros ?",
      type: "OTHER",
    });
    expect(res.success).toBe(true);
    expect(mockClaimCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "OTHER",
          orderId: null,
          orderItems: undefined,
        }),
      }),
    );
  });

  it("traite un appel legacy sans type comme OTHER (compat)", async () => {
    const res = await createClaim({
      subject: "Question",
      message: "Message",
    });
    expect(res.success).toBe(true);
    expect(mockClaimCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "OTHER" }),
      }),
    );
  });
});

describe("createClaim — auth (rappel)", () => {
  it("refuse un compte PENDING", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u-pending", role: "CLIENT", status: "PENDING" },
    });
    const res = await createClaim({ subject: "X", message: "Y" });
    expect(res.success).toBe(false);
  });

  it("refuse un visiteur non connecté", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await createClaim({ subject: "X", message: "Y" });
    expect(res.success).toBe(false);
  });
});
