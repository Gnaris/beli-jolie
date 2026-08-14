import { describe, it, expect } from "vitest";
import { normalizeAnkorstoreStatus } from "@/lib/ankorstore-orders-sync";
import { AnkorstoreOrderStatus } from "@prisma/client";

describe("ankorstore-orders-sync — normalizeAnkorstoreStatus", () => {
  it("mappe pending/submitted/needs_review/retailer_paid → NEW", () => {
    expect(normalizeAnkorstoreStatus("pending")).toBe(AnkorstoreOrderStatus.NEW);
    expect(normalizeAnkorstoreStatus("submitted")).toBe(AnkorstoreOrderStatus.NEW);
    expect(normalizeAnkorstoreStatus("needs_review")).toBe(AnkorstoreOrderStatus.NEW);
    expect(normalizeAnkorstoreStatus("retailer_paid")).toBe(AnkorstoreOrderStatus.NEW);
  });

  it("mappe ankor_confirmed/brand_confirmed → VALIDATED", () => {
    expect(normalizeAnkorstoreStatus("ankor_confirmed")).toBe(AnkorstoreOrderStatus.VALIDATED);
    expect(normalizeAnkorstoreStatus("brand_confirmed")).toBe(AnkorstoreOrderStatus.VALIDATED);
  });

  it("mappe shipped/delivered/brand_paid/invoiced → SHIPPED", () => {
    expect(normalizeAnkorstoreStatus("shipped")).toBe(AnkorstoreOrderStatus.SHIPPED);
    expect(normalizeAnkorstoreStatus("delivered")).toBe(AnkorstoreOrderStatus.SHIPPED);
    expect(normalizeAnkorstoreStatus("brand_paid")).toBe(AnkorstoreOrderStatus.SHIPPED);
    expect(normalizeAnkorstoreStatus("invoiced")).toBe(AnkorstoreOrderStatus.SHIPPED);
  });

  it("mappe cancelled/rejected/brand_rejected/retailer_rejected → CANCELLED", () => {
    expect(normalizeAnkorstoreStatus("cancelled")).toBe(AnkorstoreOrderStatus.CANCELLED);
    expect(normalizeAnkorstoreStatus("canceled")).toBe(AnkorstoreOrderStatus.CANCELLED);
    expect(normalizeAnkorstoreStatus("rejected")).toBe(AnkorstoreOrderStatus.CANCELLED);
    expect(normalizeAnkorstoreStatus("brand_rejected")).toBe(AnkorstoreOrderStatus.CANCELLED);
    expect(normalizeAnkorstoreStatus("retailer_rejected")).toBe(AnkorstoreOrderStatus.CANCELLED);
  });

  it("est insensible à la casse et aux espaces", () => {
    expect(normalizeAnkorstoreStatus("  Shipped  ")).toBe(AnkorstoreOrderStatus.SHIPPED);
    expect(normalizeAnkorstoreStatus("BRAND_PAID")).toBe(AnkorstoreOrderStatus.SHIPPED);
  });

  it("retombe sur NEW pour toute valeur inconnue (fail-safe)", () => {
    // Un statut inconnu ne doit JAMAIS déclencher la déduction de stock ni la
    // marquer expédiée par erreur — on retombe sur NEW.
    expect(normalizeAnkorstoreStatus("foo_bar")).toBe(AnkorstoreOrderStatus.NEW);
    expect(normalizeAnkorstoreStatus("")).toBe(AnkorstoreOrderStatus.NEW);
    expect(normalizeAnkorstoreStatus("undefined")).toBe(AnkorstoreOrderStatus.NEW);
  });
});
