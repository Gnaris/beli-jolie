/**
 * Tests unitaires du serializer marketplace-queue.
 *
 * On vérifie surtout que la conversion mode client ↔ mode DB tient sur les
 * 3 modes historiques (publish/refresh/resync) ET les 3 nouveaux modes
 * Microstore (disable/enable/delete) ajoutés le 2026-08-25 pour que toutes
 * les actions Microstore passent par la file marketplace.
 */
import { describe, it, expect } from "vitest";
import {
  mapModeToDb,
  validateEnqueueInput,
  type ClientMode,
} from "@/lib/marketplace-queue-serializer";

describe("mapModeToDb — 3 modes historiques + 3 nouveaux modes Microstore", () => {
  it("publish → PUBLISH", () => {
    expect(mapModeToDb("publish")).toBe("PUBLISH");
  });
  it("refresh → REFRESH (défaut)", () => {
    expect(mapModeToDb("refresh")).toBe("REFRESH");
  });
  it("resync → RESYNC", () => {
    expect(mapModeToDb("resync")).toBe("RESYNC");
  });
  it("disable → DISABLE", () => {
    expect(mapModeToDb("disable")).toBe("DISABLE");
  });
  it("enable → ENABLE", () => {
    expect(mapModeToDb("enable")).toBe("ENABLE");
  });
  it("delete → DELETE", () => {
    expect(mapModeToDb("delete")).toBe("DELETE");
  });
});

describe("validateEnqueueInput — accepte tous les modes", () => {
  const base = {
    productId: "p1",
    reference: "REF-1",
    productName: "Produit",
    firstImage: null,
    options: { microstore: true },
    marketplace: "microstore" as const,
  };

  const modes: ClientMode[] = [
    "publish",
    "refresh",
    "resync",
    "disable",
    "enable",
    "delete",
  ];

  for (const mode of modes) {
    it(`accepte mode="${mode}"`, () => {
      const res = validateEnqueueInput([{ ...base, mode }]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.items[0].mode).toBe(mode);
      }
    });
  }

  it("refuse un mode inconnu (undefined dans l'item validé)", () => {
    const res = validateEnqueueInput([{ ...base, mode: "yolo" as unknown as ClientMode }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items[0].mode).toBeUndefined();
    }
  });
});
