import { describe, it, expect } from "vitest";
import {
  getOrderVisibleStatus,
  getVisibleStatusLabel,
} from "@/lib/order-visible-status";

describe("getOrderVisibleStatus", () => {
  it("retourne CANCELLED si la commande est annulée (peu importe le paiement)", () => {
    expect(
      getOrderVisibleStatus({ status: "CANCELLED", paymentStatus: "paid", paymentMode: "CARD" }),
    ).toBe("CANCELLED");
    expect(
      getOrderVisibleStatus({ status: "CANCELLED", paymentStatus: "pending", paymentMode: "BANK_TRANSFER" }),
    ).toBe("CANCELLED");
  });

  it("retourne SHIPPED si la commande est expédiée", () => {
    expect(
      getOrderVisibleStatus({ status: "SHIPPED", paymentStatus: "paid", paymentMode: "CARD" }),
    ).toBe("SHIPPED");
  });

  it("retourne WAITING_PAYMENT si virement en attente (paymentMode BANK_TRANSFER + paymentStatus pending)", () => {
    expect(
      getOrderVisibleStatus({ status: "PENDING", paymentStatus: "pending", paymentMode: "BANK_TRANSFER" }),
    ).toBe("WAITING_PAYMENT");
  });

  it("retourne PAID si virement confirmé (BANK_TRANSFER + paid)", () => {
    expect(
      getOrderVisibleStatus({ status: "PENDING", paymentStatus: "paid", paymentMode: "BANK_TRANSFER" }),
    ).toBe("PAID");
  });

  it("retourne PAID pour une commande carte payée", () => {
    expect(
      getOrderVisibleStatus({ status: "PENDING", paymentStatus: "paid", paymentMode: "CARD" }),
    ).toBe("PAID");
  });

  it("traite les commandes historiques (paymentMode null) comme CARD", () => {
    expect(
      getOrderVisibleStatus({ status: "PENDING", paymentStatus: "paid", paymentMode: null }),
    ).toBe("PAID");
    // pending + null → PAID (comme carte échouée qui atterrit dans admin, edge legacy)
    expect(
      getOrderVisibleStatus({ status: "PENDING", paymentStatus: "pending", paymentMode: null }),
    ).toBe("PAID");
  });
});

describe("getVisibleStatusLabel", () => {
  it("renvoie les libellés FR par défaut", () => {
    expect(getVisibleStatusLabel("WAITING_PAYMENT")).toBe("En attente de paiement");
    expect(getVisibleStatusLabel("PAID")).toBe("Paiement reçu");
    expect(getVisibleStatusLabel("SHIPPED")).toBe("Expédiée");
    expect(getVisibleStatusLabel("CANCELLED")).toBe("Annulée");
  });

  it("renvoie les libellés EN si locale demandée", () => {
    expect(getVisibleStatusLabel("WAITING_PAYMENT", "en")).toBe("Awaiting payment");
    expect(getVisibleStatusLabel("PAID", "en")).toBe("Payment received");
  });
});
