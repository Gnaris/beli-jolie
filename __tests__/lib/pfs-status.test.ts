import { describe, it, expect } from "vitest";
import { mapLocalToPfsStatus } from "@/lib/pfs-status";

describe("mapLocalToPfsStatus", () => {
  it("ARCHIVED local → ARCHIVED PFS (peu importe stock)", () => {
    expect(mapLocalToPfsStatus("ARCHIVED", false)).toBe("ARCHIVED");
    expect(mapLocalToPfsStatus("ARCHIVED", true)).toBe("ARCHIVED");
  });

  it("ONLINE local + stock dispo → READY_FOR_SALE PFS", () => {
    expect(mapLocalToPfsStatus("ONLINE", false)).toBe("READY_FOR_SALE");
  });

  it("ONLINE local + toutes variantes en rupture → ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("ONLINE", true)).toBe("ARCHIVED");
  });

  it("OFFLINE local + stock dispo → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("OFFLINE", false)).toBe("DRAFT");
  });

  it("OFFLINE local + toutes variantes en rupture → ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("OFFLINE", true)).toBe("ARCHIVED");
  });

  it("SYNCING local + stock dispo → DRAFT PFS", () => {
    expect(mapLocalToPfsStatus("SYNCING", false)).toBe("DRAFT");
  });

  it("SYNCING local + toutes variantes en rupture → ARCHIVED PFS", () => {
    expect(mapLocalToPfsStatus("SYNCING", true)).toBe("ARCHIVED");
  });
});
