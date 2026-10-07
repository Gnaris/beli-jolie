import { describe, it, expect, beforeEach } from "vitest";
import { tenantALS } from "@/lib/tenant-als";
import { emitAdminEvent, subscribeAdminEvents, type AdminEvent } from "@/lib/admin-events";

describe("admin-events", () => {
  beforeEach(() => {
    // Vide le store partagé via globalThis pour éviter la pollution entre tests.
    const g = globalThis as unknown as Record<string, Set<unknown>>;
    g["__bj_admin_event_listeners__"] = new Set();
  });

  it("capture automatiquement le tenantId depuis l'ALS", () => {
    const received: AdminEvent[] = [];
    subscribeAdminEvents((e) => received.push(e));

    tenantALS.run("issyma", () => {
      emitAdminEvent({ type: "CLIENT_NEW", userId: "u1" });
    });

    expect(received).toHaveLength(1);
    expect(received[0].tenantId).toBe("issyma");
    expect(received[0].type).toBe("CLIENT_NEW");
    expect(received[0].userId).toBe("u1");
    expect(typeof received[0].timestamp).toBe("number");
  });

  it("respecte un tenantId explicite passé par l'appelant", () => {
    const received: AdminEvent[] = [];
    subscribeAdminEvents((e) => received.push(e));

    tenantALS.run("issyma", () => {
      emitAdminEvent({ type: "ORDER_NEW", orderId: "o1", tenantId: "beliandjolie" });
    });

    expect(received[0].tenantId).toBe("beliandjolie");
  });

  it("un abonné SSE doit pouvoir filtrer les events d'un autre tenant", () => {
    // Reproduit la logique du filtre dans /api/admin/stream : un admin
    // BJ ne doit recevoir QUE les events de son tenant.
    const requestTenantId = "beliandjolie";
    const kept: AdminEvent[] = [];

    subscribeAdminEvents((event) => {
      if (requestTenantId && event.tenantId !== requestTenantId) return;
      kept.push(event);
    });

    tenantALS.run("issyma", () => {
      emitAdminEvent({ type: "ORDER_NEW", orderId: "issyma-1" });
    });
    tenantALS.run("beliandjolie", () => {
      emitAdminEvent({ type: "ORDER_NEW", orderId: "bj-1" });
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].orderId).toBe("bj-1");
  });

  it("unsubscribe arrête la réception", () => {
    const received: AdminEvent[] = [];
    const unsubscribe = subscribeAdminEvents((e) => received.push(e));

    tenantALS.run("bj", () => {
      emitAdminEvent({ type: "CLIENT_STATUS", userId: "u1", online: true });
    });
    expect(received).toHaveLength(1);

    unsubscribe();

    tenantALS.run("bj", () => {
      emitAdminEvent({ type: "CLIENT_STATUS", userId: "u2", online: true });
    });
    expect(received).toHaveLength(1);
  });

  it("un listener qui lève une exception ne bloque pas les autres", () => {
    const received: AdminEvent[] = [];

    subscribeAdminEvents(() => {
      throw new Error("boom");
    });
    subscribeAdminEvents((e) => received.push(e));

    tenantALS.run("bj", () => {
      emitAdminEvent({ type: "CLIENT_NEW", userId: "u1" });
    });

    expect(received).toHaveLength(1);
  });
});
