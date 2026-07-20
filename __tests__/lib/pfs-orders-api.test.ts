import { describe, it, expect } from "vitest";
import { normalizePfsStatus, parsePfsListDate } from "@/lib/pfs-orders-api";

describe("pfs-orders-api — normalizePfsStatus", () => {
  it("mappe les statuts connus", () => {
    expect(normalizePfsStatus("NEW")).toBe("NEW");
    expect(normalizePfsStatus("VALIDATED")).toBe("VALIDATED");
    expect(normalizePfsStatus("SENT")).toBe("SENT");
    expect(normalizePfsStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("supporte l'orthographe US 'CANCELED'", () => {
    expect(normalizePfsStatus("CANCELED")).toBe("CANCELLED");
  });

  it("est tolérant à la casse", () => {
    expect(normalizePfsStatus("sent")).toBe("SENT");
    expect(normalizePfsStatus("Validated")).toBe("VALIDATED");
  });

  it("retombe sur NEW pour toute valeur inconnue", () => {
    expect(normalizePfsStatus("PENDING_PAYMENT")).toBe("NEW");
    expect(normalizePfsStatus("")).toBe("NEW");
    expect(normalizePfsStatus(undefined as unknown as string)).toBe("NEW");
  });
});

describe("pfs-orders-api — parsePfsListDate", () => {
  it("parse le format 'YYYY-MM-DD HH:mm:ss'", () => {
    const d = parsePfsListDate("2026-07-20 16:06:17");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6); // 0-indexé
    expect(d.getUTCDate()).toBe(20);
    expect(d.getUTCHours()).toBe(16);
    expect(d.getUTCMinutes()).toBe(6);
  });
});
