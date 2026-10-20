/**
 * Tests pour `lib/push-hooks.ts` — vérifie que les events admin/chat
 * déclenchent bien l'envoi de push avec le bon payload et sans fuite
 * cross-tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminEvent } from "@/lib/admin-events";
import type { ChatEvent } from "@/lib/chat-events";

const sendPushMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => {
  type OrderRow = {
    id: string;
    orderNumber: string;
    totalTTC: number;
    user: { company: string | null; firstName: string | null; lastName: string | null } | null;
  };
  type UserRow = { company: string | null; firstName: string | null; lastName: string | null };
  type ConvRow = {
    subject?: string | null;
    claim: { id: string; reference: string; subject?: string | null } | null;
  };

  let orderResult: OrderRow | null = null;
  let userResult: UserRow | null = null;
  let convResult: ConvRow | null = null;
  let siteConfigResult: { value: string } | null = null;

  return {
    order: {
      findFirst: vi.fn(async () => orderResult),
    },
    user: {
      findFirst: vi.fn(async () => userResult),
    },
    conversation: {
      findFirst: vi.fn(async () => convResult),
    },
    // getPushPreferences lit SiteConfig — on retourne null par défaut
    // → fallback sur DEFAULT_PUSH_PREFERENCES (tous les events activés).
    siteConfig: {
      findFirst: vi.fn(async () => siteConfigResult),
    },
    _setOrder(r: OrderRow | null) { orderResult = r; },
    _setUser(r: UserRow | null) { userResult = r; },
    _setConv(r: ConvRow | null) { convResult = r; },
    _setSiteConfig(v: string | null) { siteConfigResult = v == null ? null : { value: v }; },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/push-notifications", () => ({ sendPushToAdmins: sendPushMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// On ne veut pas que le ALS pose problème dans ce test ; wrap pass-through.
vi.mock("@/lib/tenant-als", () => ({
  tenantALS: {
    run: (_tenantId: string, fn: () => unknown) => fn(),
  },
  // Nécessaire pour `admin-events.ts` qui lit l'ALS lors de l'emit.
  getCurrentTenantIdSync: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock._setOrder(null);
  prismaMock._setUser(null);
  prismaMock._setConv(null);
  // Par défaut : pas de prefs → fallback aux DEFAULT_PUSH_PREFERENCES (tout activé).
  prismaMock._setSiteConfig(null);
});

async function fireAdmin(event: AdminEvent): Promise<void> {
  // On accède au dispatcher via l'import (il est privé, donc on re-déclare
  // la signature). On teste à travers subscribeAdminEvents comme en prod.
  const { subscribeAdminEvents, emitAdminEvent } = await import("@/lib/admin-events");
  // On vide le registre avant d'enregistrer les hooks à neuf.
  const g = globalThis as Record<string, Set<unknown>>;
  g["__bj_admin_event_listeners__"] = new Set();
  const sym = Symbol.for("beliandjolie.push-hooks.installed");
  (globalThis as Record<symbol, unknown>)[sym] = undefined;

  const { registerPushHooks } = await import("@/lib/push-hooks");
  registerPushHooks();

  // Capturer les events reçus pour debug.
  const received: AdminEvent[] = [];
  subscribeAdminEvents((e) => received.push(e));

  emitAdminEvent({ ...event, tenantId: event.tenantId });
  // Laisser le temps aux IIFE async des hooks.
  await new Promise((r) => setTimeout(r, 10));
}

async function fireChat(event: ChatEvent): Promise<void> {
  const { subscribeChatEvents, emitChatEvent } = await import("@/lib/chat-events");
  const g = globalThis as Record<string, Set<unknown>>;
  g["__bj_chat_event_listeners__"] = new Set();
  const sym = Symbol.for("beliandjolie.push-hooks.installed");
  (globalThis as Record<symbol, unknown>)[sym] = undefined;

  const { registerPushHooks } = await import("@/lib/push-hooks");
  registerPushHooks();

  const received: ChatEvent[] = [];
  subscribeChatEvents((e) => received.push(e));
  emitChatEvent({ ...event });
  await new Promise((r) => setTimeout(r, 10));
}

describe("push-hooks – admin events", () => {
  it("ORDER_NEW envoie un push avec montant + nom client", async () => {
    prismaMock._setOrder({
      id: "ord-1",
      orderNumber: "ABCD1234",
      totalTTC: 250.5,
      user: { company: "ACME Co", firstName: null, lastName: null },
    });

    await fireAdmin({
      type: "ORDER_NEW",
      tenantId: "tenant-A",
      orderId: "ord-1",
      orderNumber: "ABCD1234",
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [tenantId, payload] = sendPushMock.mock.calls[0];
    expect(tenantId).toBe("tenant-A");
    expect(payload.title).toContain("Nouvelle commande");
    expect(payload.title).toContain("250");
    expect(payload.body).toContain("ACME Co");
    expect(payload.body).toContain("ABCD1234");
    expect(payload.url).toBe("/admin/commandes/ord-1");
    expect(payload.tag).toBe("order-ord-1");
    expect(payload.requireInteraction).toBe(true);
  });

  it("ORDER_NEW sans tenantId → aucun push envoyé", async () => {
    prismaMock._setOrder({
      id: "x", orderNumber: "x", totalTTC: 0, user: null,
    });
    await fireAdmin({
      type: "ORDER_NEW",
      orderId: "x",
      timestamp: Date.now(),
    });
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("CLIENT_NEW envoie un push avec le nom de la société", async () => {
    prismaMock._setUser({
      company: "Bijoux Dupont",
      firstName: "Jean",
      lastName: "Dupont",
    });

    await fireAdmin({
      type: "CLIENT_NEW",
      tenantId: "tenant-A",
      userId: "u-1",
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [, payload] = sendPushMock.mock.calls[0];
    expect(payload.title).toBe("Nouvelle inscription");
    expect(payload.body).toContain("Bijoux Dupont");
    expect(payload.url).toBe("/admin/clients");
    expect(payload.tag).toBe("client-u-1");
  });

  it("CLIENT_STATUS n'envoie PAS de push (trop bruyant)", async () => {
    await fireAdmin({
      type: "CLIENT_STATUS",
      tenantId: "tenant-A",
      userId: "u-1",
      online: true,
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

describe("push-hooks – chat events", () => {
  it("NEW_MESSAGE targetRole=ADMIN hors claim → push « Message »", async () => {
    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "ADMIN",
      messageData: {
        id: "msg-1",
        content: "Bonjour, je voudrais savoir si…",
        senderRole: "CLIENT",
        senderName: "Marc",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [, payload] = sendPushMock.mock.calls[0];
    expect(payload.title).toBe("Message · Marc");
    expect(payload.body).toContain("Bonjour");
    expect(payload.url).toBe("/admin/messagerie?conv=conv-1");
    expect(payload.tag).toBe("conv-conv-1");
    expect(payload.requireInteraction).toBe(false);
  });

  it("NEW_MESSAGE context=claim → push SAV avec URL /admin/sav/{ref}", async () => {
    prismaMock._setConv({
      claim: { id: "claim-1", reference: "SAV-2026-ABC" },
    });

    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "ADMIN",
      context: "claim",
      messageData: {
        id: "msg-1",
        content: "Produit cassé",
        senderRole: "CLIENT",
        senderName: "Sophie",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [, payload] = sendPushMock.mock.calls[0];
    expect(payload.title).toBe("Nouveau SAV · Sophie");
    expect(payload.url).toBe("/admin/sav/SAV-2026-ABC");
    expect(payload.requireInteraction).toBe(true);
  });

  it("NEW_MESSAGE targetRole=CLIENT → aucun push (pas pour l'admin)", async () => {
    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "CLIENT",
      messageData: {
        id: "msg-1",
        content: "Réponse admin",
        senderRole: "ADMIN",
        senderName: "Admin",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("TYPING_START/STOP et MESSAGE_READ n'envoient pas de push", async () => {
    for (const type of ["TYPING_START", "TYPING_STOP", "MESSAGE_READ"] as const) {
      sendPushMock.mockClear();
      await fireChat({
        type,
        tenantId: "tenant-A",
        conversationId: "conv-1",
        userId: "user-1",
        targetRole: "ADMIN",
        timestamp: Date.now(),
      });
      expect(sendPushMock).not.toHaveBeenCalled();
    }
  });

  it("messages longs sont tronqués à 100 caractères avec ellipse", async () => {
    const longMsg = "a".repeat(200);
    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "ADMIN",
      messageData: {
        id: "msg-1",
        content: longMsg,
        senderRole: "CLIENT",
        senderName: "Un client",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [, payload] = sendPushMock.mock.calls[0];
    expect(payload.body.length).toBeLessThanOrEqual(100);
    expect(payload.body.endsWith("…")).toBe(true);
  });
});

describe("push-hooks – préférences par type", () => {
  it("ORDER_NEW désactivé → aucun push envoyé", async () => {
    prismaMock._setOrder({
      id: "ord-1", orderNumber: "X", totalTTC: 100, user: { company: "ACME", firstName: null, lastName: null },
    });
    prismaMock._setSiteConfig(JSON.stringify({
      order_new: { enabled: false, title: "T", body: "B" },
    }));

    await fireAdmin({
      type: "ORDER_NEW",
      tenantId: "tenant-A",
      orderId: "ord-1",
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("CLIENT_NEW désactivé → aucun push envoyé", async () => {
    prismaMock._setUser({ company: "ACME", firstName: null, lastName: null });
    prismaMock._setSiteConfig(JSON.stringify({
      client_new: { enabled: false, title: "T", body: "B" },
    }));

    await fireAdmin({
      type: "CLIENT_NEW",
      tenantId: "tenant-A",
      userId: "u-1",
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("chat_message désactivé → aucun push pour message chat normal", async () => {
    prismaMock._setSiteConfig(JSON.stringify({
      chat_message: { enabled: false, title: "T", body: "B" },
    }));

    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "ADMIN",
      messageData: {
        id: "msg-1", content: "hello", senderRole: "CLIENT", senderName: "Marc",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("claim_new désactivé → aucun push pour message SAV", async () => {
    prismaMock._setConv({ claim: { id: "c1", reference: "SAV-X", subject: "s" } });
    prismaMock._setSiteConfig(JSON.stringify({
      claim_new: { enabled: false, title: "T", body: "B" },
    }));

    await fireChat({
      type: "NEW_MESSAGE",
      tenantId: "tenant-A",
      conversationId: "conv-1",
      userId: "user-1",
      targetRole: "ADMIN",
      context: "claim",
      messageData: {
        id: "msg-1", content: "SAV message", senderRole: "CLIENT", senderName: "Sophie",
        createdAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("template personnalisé est appliqué avec les placeholders substitués", async () => {
    prismaMock._setOrder({
      id: "ord-9", orderNumber: "ZZZ999", totalTTC: 420.5,
      user: { company: "Shop Co", firstName: null, lastName: null },
    });
    prismaMock._setSiteConfig(JSON.stringify({
      order_new: {
        enabled: true,
        title: "🎉 {customer} a commandé pour {amount}",
        body: "Ref {orderNumber} — go préparer !",
      },
    }));

    await fireAdmin({
      type: "ORDER_NEW",
      tenantId: "tenant-A",
      orderId: "ord-9",
      timestamp: Date.now(),
    });

    expect(sendPushMock).toHaveBeenCalledOnce();
    const [, payload] = sendPushMock.mock.calls[0];
    expect(payload.title).toContain("Shop Co");
    expect(payload.title).toContain("420");
    expect(payload.title.startsWith("🎉")).toBe(true);
    expect(payload.body).toContain("ZZZ999");
    expect(payload.body).toContain("go préparer");
  });
});
