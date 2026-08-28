import { describe, it, expect } from "vitest";
import { getOrderStatusVisual } from "@/lib/order-status-visual";

describe("getOrderStatusVisual", () => {
  it("mappe PENDING sur l'ambre (nouveau/en attente)", () => {
    const v = getOrderStatusVisual("PENDING");
    expect(v.dot).toBe("bg-amber-500");
    expect(v.pill).toContain("bg-amber-100");
    expect(v.pill).toContain("text-amber-800");
  });

  it("mappe VALIDATED sur le sky (validée)", () => {
    const v = getOrderStatusVisual("VALIDATED");
    expect(v.dot).toBe("bg-sky-500");
    expect(v.pill).toContain("bg-sky-100");
  });

  it("mappe SHIPPED sur l'emerald (expédiée)", () => {
    const v = getOrderStatusVisual("SHIPPED");
    expect(v.dot).toBe("bg-emerald-500");
    expect(v.pill).toContain("bg-emerald-100");
  });

  it("mappe CANCELLED sur le rose (annulée)", () => {
    const v = getOrderStatusVisual("CANCELLED");
    expect(v.dot).toBe("bg-rose-500");
    expect(v.pill).toContain("bg-rose-100");
  });

  it("retombe sur le neutre pour un statut inconnu", () => {
    const v = getOrderStatusVisual("UNKNOWN_STATUS");
    expect(v.dot).toBe("bg-slate-400");
    expect(v.pill).toContain("bg-slate-100");
  });
});
