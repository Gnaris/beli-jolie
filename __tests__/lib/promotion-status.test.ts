import { describe, it, expect } from "vitest";
import {
  effectivePromotionStatus,
  usageProgress,
  progressTone,
  formatDiscountDisplay,
} from "@/lib/promotion-status";

const NOW = new Date("2026-07-03T12:00:00Z");
const yesterday = new Date("2026-07-02T12:00:00Z");
const tomorrow = new Date("2026-07-04T12:00:00Z");

describe("effectivePromotionStatus", () => {
  it("retourne INACTIVE quand le toggle est désactivé", () => {
    expect(effectivePromotionStatus({
      isActive: false, startsAt: yesterday, endsAt: null, maxUses: null, currentUses: 0,
    }, NOW)).toBe("INACTIVE");
  });

  it("retourne SCHEDULED quand startsAt est dans le futur", () => {
    expect(effectivePromotionStatus({
      isActive: true, startsAt: tomorrow, endsAt: null, maxUses: null, currentUses: 0,
    }, NOW)).toBe("SCHEDULED");
  });

  it("retourne EXPIRED quand endsAt est passé", () => {
    expect(effectivePromotionStatus({
      isActive: true, startsAt: yesterday, endsAt: yesterday, maxUses: null, currentUses: 0,
    }, NOW)).toBe("EXPIRED");
  });

  it("retourne EXHAUSTED quand maxUses atteint", () => {
    expect(effectivePromotionStatus({
      isActive: true, startsAt: yesterday, endsAt: null, maxUses: 10, currentUses: 10,
    }, NOW)).toBe("EXHAUSTED");
  });

  it("retourne ACTIVE quand tout est vert", () => {
    expect(effectivePromotionStatus({
      isActive: true, startsAt: yesterday, endsAt: tomorrow, maxUses: 100, currentUses: 5,
    }, NOW)).toBe("ACTIVE");
  });

  it("accepte les dates en string ISO", () => {
    expect(effectivePromotionStatus({
      isActive: true, startsAt: "2026-07-02T12:00:00Z", endsAt: null, maxUses: null, currentUses: 0,
    }, NOW)).toBe("ACTIVE");
  });

  it("INACTIVE prime sur SCHEDULED (le toggle éteint tout)", () => {
    expect(effectivePromotionStatus({
      isActive: false, startsAt: tomorrow, endsAt: null, maxUses: null, currentUses: 0,
    }, NOW)).toBe("INACTIVE");
  });
});

describe("usageProgress", () => {
  it("retourne null quand illimité", () => {
    expect(usageProgress(5, null)).toBeNull();
    expect(usageProgress(5, 0)).toBeNull();
  });

  it("calcule le ratio 0..1", () => {
    expect(usageProgress(0, 100)).toBe(0);
    expect(usageProgress(50, 100)).toBe(0.5);
    expect(usageProgress(100, 100)).toBe(1);
  });

  it("clamp à 1 en cas de dépassement", () => {
    expect(usageProgress(120, 100)).toBe(1);
  });
});

describe("progressTone", () => {
  it("retourne neutral < 60 %", () => {
    expect(progressTone(0)).toBe("neutral");
    expect(progressTone(0.59)).toBe("neutral");
    expect(progressTone(null)).toBe("neutral");
  });
  it("retourne warn entre 60 et 89 %", () => {
    expect(progressTone(0.6)).toBe("warn");
    expect(progressTone(0.89)).toBe("warn");
  });
  it("retourne ok à partir de 90 %", () => {
    expect(progressTone(0.9)).toBe("ok");
    expect(progressTone(1)).toBe("ok");
  });
});

describe("formatDiscountDisplay", () => {
  it("livraison offerte", () => {
    expect(formatDiscountDisplay("FREE_SHIPPING", 0)).toEqual({
      main: "Livraison", unit: "offerte", isText: true,
    });
  });
  it("pourcentage arrondi", () => {
    expect(formatDiscountDisplay("PERCENTAGE", 10)).toEqual({
      main: "-10%", unit: "Remise", isText: false,
    });
    expect(formatDiscountDisplay("PERCENTAGE", 15.5)).toEqual({
      main: "-16%", unit: "Remise", isText: false,
    });
  });
  it("montant fixe entier", () => {
    expect(formatDiscountDisplay("FIXED_AMOUNT", 15)).toEqual({
      main: "-15 €", unit: "Remise", isText: false,
    });
  });
  it("montant fixe décimal avec virgule française", () => {
    expect(formatDiscountDisplay("FIXED_AMOUNT", 12.5)).toEqual({
      main: "-12,50 €", unit: "Remise", isText: false,
    });
  });
});
