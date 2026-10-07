import { describe, it, expect, beforeEach } from "vitest";
import { tenantALS } from "@/lib/tenant-als";
import { emitChatEvent, subscribeChatEvents, type ChatEvent } from "@/lib/chat-events";

describe("chat-events / isolation multi-tenant", () => {
  beforeEach(() => {
    // Vide le store d'écouteurs partagé via globalThis pour ne pas polluer.
    const g = globalThis as unknown as Record<string, Set<unknown>>;
    g["__bj_chat_event_listeners__"] = new Set();
  });

  it("capture automatiquement le tenantId depuis l'ALS quand emitChatEvent ne le fournit pas", () => {
    const received: ChatEvent[] = [];
    subscribeChatEvents((e) => received.push(e));

    tenantALS.run("issyma", () => {
      emitChatEvent({
        type: "NEW_MESSAGE",
        conversationId: "conv-1",
        userId: "user-1",
        targetRole: "ADMIN",
      });
    });

    expect(received).toHaveLength(1);
    expect(received[0].tenantId).toBe("issyma");
  });

  it("respecte un tenantId explicite fourni par l'appelant", () => {
    const received: ChatEvent[] = [];
    subscribeChatEvents((e) => received.push(e));

    tenantALS.run("issyma", () => {
      emitChatEvent({
        type: "NEW_MESSAGE",
        conversationId: "conv-1",
        userId: "user-1",
        targetRole: "ADMIN",
        tenantId: "beliandjolie", // override explicite
      });
    });

    expect(received[0].tenantId).toBe("beliandjolie");
  });

  it("un abonné doit pouvoir filtrer les events d'un autre tenant (reproduction du bug notification chat)", () => {
    // On simule la logique du SSE /api/chat/stream : un admin BJ ne veut
    // recevoir QUE les events de son tenant. Avant le fix, aucun tenantId
    // n'existait sur l'event et le son sonnait chez tout le monde.
    const requestTenantId = "beliandjolie";
    const beliJolieAdminReceived: ChatEvent[] = [];

    subscribeChatEvents((event) => {
      if (event.targetRole !== "ADMIN") return;
      // Filtre fail-closed : si on connaît notre tenant, on refuse tout
      // event qui n'a pas EXACTEMENT ce tenantId (y compris undefined).
      if (requestTenantId && event.tenantId !== requestTenantId) return;
      beliJolieAdminReceived.push(event);
    });

    // Un client Issyma envoie un message → event émis dans l'ALS Issyma.
    tenantALS.run("issyma", () => {
      emitChatEvent({
        type: "NEW_MESSAGE",
        conversationId: "conv-issyma",
        userId: "client-issyma",
        targetRole: "ADMIN",
      });
    });

    // Un client BJ envoie un message → event émis dans l'ALS BJ.
    tenantALS.run("beliandjolie", () => {
      emitChatEvent({
        type: "NEW_MESSAGE",
        conversationId: "conv-bj",
        userId: "client-bj",
        targetRole: "ADMIN",
      });
    });

    expect(beliJolieAdminReceived).toHaveLength(1);
    expect(beliJolieAdminReceived[0].conversationId).toBe("conv-bj");
  });

  it("fail-closed : un event sans tenantId NE DOIT PAS atteindre un admin scopé par tenant (bug son chat 2026-10-07)", () => {
    // Scénario réel : un émetteur appelle emitChatEvent sans que l'ALS soit
    // bindée (ex : ALS non peuplée par le callsite). Résultat : event.tenantId
    // undefined. Avant le fix, le filtre `event.tenantId && …` tombait sur
    // undefined → false → event laissé passer sur TOUS les tenants.
    const requestTenantId = "beliandjolie";
    const beliJolieAdminReceived: ChatEvent[] = [];

    subscribeChatEvents((event) => {
      if (event.targetRole !== "ADMIN") return;
      if (requestTenantId && event.tenantId !== requestTenantId) return;
      beliJolieAdminReceived.push(event);
    });

    // Pas de tenantALS.run — l'event est émis hors ALS, tenantId undefined.
    emitChatEvent({
      type: "NEW_MESSAGE",
      conversationId: "conv-orpheline",
      userId: "client-x",
      targetRole: "ADMIN",
    });

    expect(beliJolieAdminReceived).toHaveLength(0);
  });
});
