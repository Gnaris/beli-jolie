import { describe, it, expect } from "vitest";
import { mapLocalToPfsStatus } from "@/lib/pfs-status";

describe("mapLocalToPfsStatus", () => {
  it("ARCHIVED local avec stock → ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("ARCHIVED", false)).toBe("ARCHIVED");
  });

  it("ONLINE local + stock dispo → READY_FOR_SALE PFS", () => {
    expect(mapLocalToPfsStatus("ONLINE", false)).toBe("READY_FOR_SALE");
  });

  it("ONLINE local + toutes variantes en rupture → défaut ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("ONLINE", true)).toBe("ARCHIVED");
  });

  it("OFFLINE local + stock dispo → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("OFFLINE", false)).toBe("DRAFT");
  });

  it("OFFLINE local + toutes variantes en rupture → défaut ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("OFFLINE", true)).toBe("ARCHIVED");
  });

  it("SYNCING local + stock dispo → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("SYNCING", false)).toBe("DRAFT");
  });

  it("SYNCING local + toutes variantes en rupture → défaut ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("SYNCING", true)).toBe("ARCHIVED");
  });

  it("action rupture = archived → ARCHIVED", () => {
    expect(mapLocalToPfsStatus("ONLINE", true, "archived")).toBe("ARCHIVED");
    expect(mapLocalToPfsStatus("OFFLINE", true, "archived")).toBe("ARCHIVED");
  });

  it("action rupture = deleted → DELETED", () => {
    expect(mapLocalToPfsStatus("ONLINE", true, "deleted")).toBe("DELETED");
    expect(mapLocalToPfsStatus("OFFLINE", true, "deleted")).toBe("DELETED");
  });

  it("action rupture = draft → DRAFT", () => {
    expect(mapLocalToPfsStatus("ONLINE", true, "draft")).toBe("DRAFT");
    expect(mapLocalToPfsStatus("OFFLINE", true, "draft")).toBe("DRAFT");
  });

  it("ARCHIVED local + toutes variantes en rupture applique l'action rupture (auto-archive local ne doit pas court-circuiter la config)", () => {
    // Régression : avant le fix, ARCHIVED local prenait le pas → toujours ARCHIVED PFS
    // même quand la config disait "draft" ou "deleted".
    expect(mapLocalToPfsStatus("ARCHIVED", true, "deleted")).toBe("DELETED");
    expect(mapLocalToPfsStatus("ARCHIVED", true, "draft")).toBe("DRAFT");
    expect(mapLocalToPfsStatus("ARCHIVED", true, "archived")).toBe("ARCHIVED");
  });

  it("ARCHIVED local avec stock ignore la config rupture (elle ne s'applique que quand tout est à 0)", () => {
    expect(mapLocalToPfsStatus("ARCHIVED", false, "deleted")).toBe("ARCHIVED");
    expect(mapLocalToPfsStatus("ARCHIVED", false, "draft")).toBe("ARCHIVED");
  });

  it("stock dispo → action rupture ignorée", () => {
    expect(mapLocalToPfsStatus("ONLINE", false, "deleted")).toBe("READY_FOR_SALE");
    expect(mapLocalToPfsStatus("OFFLINE", false, "draft")).toBe("DRAFT");
  });
});
