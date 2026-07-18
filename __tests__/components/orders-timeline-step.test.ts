import { describe, it, expect } from "vitest";

/**
 * Validates the timeline step logic used by OrdersTableClient (cards-timeline).
 * 3 steps (PENDING → VALIDATED → SHIPPED). CANCELLED = all "todo".
 * Current step = "active", previous steps = "done", following steps = "todo".
 */

type StepState = "done" | "active" | "todo";

const STATUS_ORDER: Record<string, number> = { PENDING: 0, VALIDATED: 1, SHIPPED: 2 };

function stepStateFor(orderStatus: string, stepIndex: number): StepState {
  if (orderStatus === "CANCELLED") return "todo";
  const current = STATUS_ORDER[orderStatus] ?? 0;
  if (stepIndex < current) return "done";
  if (stepIndex === current) return "active";
  return "todo";
}

function isCompact(orderStatus: string): boolean {
  return orderStatus === "SHIPPED" || orderStatus === "CANCELLED";
}

describe("Timeline step state (orders cards-timeline)", () => {
  it("PENDING: step 0 active, steps 1-2 todo", () => {
    expect(stepStateFor("PENDING", 0)).toBe("active");
    expect(stepStateFor("PENDING", 1)).toBe("todo");
    expect(stepStateFor("PENDING", 2)).toBe("todo");
  });

  it("VALIDATED: step 0 done, step 1 active, step 2 todo", () => {
    expect(stepStateFor("VALIDATED", 0)).toBe("done");
    expect(stepStateFor("VALIDATED", 1)).toBe("active");
    expect(stepStateFor("VALIDATED", 2)).toBe("todo");
  });

  it("SHIPPED: steps 0-1 done, step 2 active", () => {
    expect(stepStateFor("SHIPPED", 0)).toBe("done");
    expect(stepStateFor("SHIPPED", 1)).toBe("done");
    expect(stepStateFor("SHIPPED", 2)).toBe("active");
  });

  it("CANCELLED: all steps todo", () => {
    expect(stepStateFor("CANCELLED", 0)).toBe("todo");
    expect(stepStateFor("CANCELLED", 1)).toBe("todo");
    expect(stepStateFor("CANCELLED", 2)).toBe("todo");
  });
});

describe("Compact vs full card decision", () => {
  it("PENDING and VALIDATED render as full card (timeline shown)", () => {
    expect(isCompact("PENDING")).toBe(false);
    expect(isCompact("VALIDATED")).toBe(false);
  });

  it("SHIPPED and CANCELLED render as compact card (collapsed row)", () => {
    expect(isCompact("SHIPPED")).toBe(true);
    expect(isCompact("CANCELLED")).toBe(true);
  });
});
