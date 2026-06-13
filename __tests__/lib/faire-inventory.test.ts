import { describe, it, expect } from "vitest";
import { buildInventoryPayload, chunkInventory } from "@/lib/faire-inventory";

describe("chunkInventory", () => {
  it("retourne un seul chunk quand l'entrée est plus petite que la taille", () => {
    const chunks = chunkInventory([1, 2, 3], 10);
    expect(chunks).toEqual([[1, 2, 3]]);
  });

  it("découpe en chunks de taille N", () => {
    const arr = Array.from({ length: 1100 }, (_, i) => i);
    const chunks = chunkInventory(arr, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[1]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(100);
  });

  it("rejette une taille ≤ 0", () => {
    expect(() => chunkInventory([1], 0)).toThrow();
  });
});

describe("buildInventoryPayload", () => {
  it("formate les SKUs avec snake_case et defaults", () => {
    const out = buildInventoryPayload([
      { sku: "abc", currentQuantity: 12 },
    ]);
    expect(out).toEqual({
      inventories: [
        { sku: "abc", current_quantity: 12, discontinued: false, backordered_until: null },
      ],
    });
  });

  it("clamp les quantités négatives à 0", () => {
    const out = buildInventoryPayload([
      { sku: "abc", currentQuantity: -5 },
    ]);
    expect(out.inventories[0].current_quantity).toBe(0);
  });

  it("plancher entier (Math.floor)", () => {
    const out = buildInventoryPayload([
      { sku: "abc", currentQuantity: 12.9 },
    ]);
    expect(out.inventories[0].current_quantity).toBe(12);
  });

  it("propage discontinued + backorderedUntil quand fournis", () => {
    const out = buildInventoryPayload([
      { sku: "abc", currentQuantity: 0, discontinued: true, backorderedUntil: "2026-07-01T00:00:00Z" },
    ]);
    expect(out.inventories[0].discontinued).toBe(true);
    expect(out.inventories[0].backordered_until).toBe("2026-07-01T00:00:00Z");
  });
});
