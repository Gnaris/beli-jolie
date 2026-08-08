import { describe, it, expect } from "vitest";
import { mapLocalToPfsStatus } from "@/lib/pfs-status";

describe("mapLocalToPfsStatus", () => {
  it("ARCHIVED local → ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("ARCHIVED")).toBe("ARCHIVED");
  });

  it("ONLINE local → READY_FOR_SALE PFS", () => {
    expect(mapLocalToPfsStatus("ONLINE")).toBe("READY_FOR_SALE");
  });

  it("OFFLINE local → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("OFFLINE")).toBe("DRAFT");
  });

  it("SYNCING (ou autre) → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("SYNCING")).toBe("DRAFT");
    expect(mapLocalToPfsStatus("UNKNOWN")).toBe("DRAFT");
  });

  it("depuis 2026-08-07 : le statut local fait foi, rupture ignorée", () => {
    // Régression : avant, une rupture totale forçait ARCHIVED/DELETED/DRAFT
    // côté PFS et cassait le pull « Modifier depuis PFS » (l'admin remettait
    // ONLINE, l'audit re-signalait un écart tant que le stock restait à 0).
    // Maintenant, seul le statut local fait foi.
    expect(mapLocalToPfsStatus("ONLINE")).toBe("READY_FOR_SALE");
    expect(mapLocalToPfsStatus("ARCHIVED")).toBe("ARCHIVED");
    expect(mapLocalToPfsStatus("OFFLINE")).toBe("DRAFT");
  });
});
