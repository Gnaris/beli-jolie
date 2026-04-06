import { describe, it, expect } from "vitest";
import { canTransition } from "@/lib/claims";

describe("canTransition", () => {
  const validTransitions: [string, string][] = [
    ["OPEN", "IN_REVIEW"],
    ["OPEN", "REJECTED"],
    ["OPEN", "CLOSED"],
    ["IN_REVIEW", "ACCEPTED"],
    ["IN_REVIEW", "REJECTED"],
    ["ACCEPTED", "RETURN_PENDING"],
    ["ACCEPTED", "RESOLUTION_PENDING"],
    ["ACCEPTED", "RESOLVED"],
    ["RETURN_PENDING", "RETURN_SHIPPED"],
    ["RETURN_SHIPPED", "RETURN_RECEIVED"],
    ["RETURN_RECEIVED", "RESOLUTION_PENDING"],
    ["RETURN_RECEIVED", "RESOLVED"],
    ["RESOLUTION_PENDING", "RESOLVED"],
    ["RESOLVED", "CLOSED"],
    ["REJECTED", "CLOSED"],
  ];

  it.each(validTransitions)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidTransitions: [string, string][] = [
    ["OPEN", "RESOLVED"],
    ["OPEN", "ACCEPTED"],
    ["IN_REVIEW", "CLOSED"],
    ["IN_REVIEW", "RETURN_PENDING"],
    ["ACCEPTED", "OPEN"],
    ["RETURN_PENDING", "RESOLVED"],
    ["RETURN_SHIPPED", "RESOLVED"],
    ["RESOLVED", "OPEN"],
    ["CLOSED", "OPEN"],
    ["REJECTED", "ACCEPTED"],
  ];

  it.each(invalidTransitions)("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("returns false for unknown status", () => {
    expect(canTransition("UNKNOWN", "OPEN")).toBe(false);
  });
});
