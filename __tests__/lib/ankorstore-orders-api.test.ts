import { describe, it, expect } from "vitest";
import {
  ankorstoreCentsToEuros,
  extractReferenceFromSku,
  extractTrackingInfo,
  normalizeAnkorstoreStatus,
} from "@/lib/ankorstore-orders-api";

describe("ankorstore-orders-api — normalizeAnkorstoreStatus", () => {
  it("mappe brand_paid, shipped, delivered, fulfilled sur SHIPPED", () => {
    expect(normalizeAnkorstoreStatus("brand_paid")).toBe("SHIPPED");
    expect(normalizeAnkorstoreStatus("shipped")).toBe("SHIPPED");
    expect(normalizeAnkorstoreStatus("delivered")).toBe("SHIPPED");
    expect(normalizeAnkorstoreStatus("fulfilled")).toBe("SHIPPED");
  });

  it("mappe ankor_confirmed, brand_confirmed, confirmed, processing, retailer_paid sur VALIDATED", () => {
    expect(normalizeAnkorstoreStatus("ankor_confirmed")).toBe("VALIDATED");
    expect(normalizeAnkorstoreStatus("brand_confirmed")).toBe("VALIDATED");
    expect(normalizeAnkorstoreStatus("confirmed")).toBe("VALIDATED");
    expect(normalizeAnkorstoreStatus("processing")).toBe("VALIDATED");
    expect(normalizeAnkorstoreStatus("retailer_paid")).toBe("VALIDATED");
  });

  it("mappe cancelled, canceled, rejected, refunded sur CANCELLED", () => {
    expect(normalizeAnkorstoreStatus("cancelled")).toBe("CANCELLED");
    expect(normalizeAnkorstoreStatus("canceled")).toBe("CANCELLED");
    expect(normalizeAnkorstoreStatus("rejected")).toBe("CANCELLED");
    expect(normalizeAnkorstoreStatus("brand_rejected")).toBe("CANCELLED");
    expect(normalizeAnkorstoreStatus("retailer_rejected")).toBe("CANCELLED");
    expect(normalizeAnkorstoreStatus("refunded")).toBe("CANCELLED");
  });

  it("retombe sur NEW pour submitted et valeurs inconnues", () => {
    expect(normalizeAnkorstoreStatus("submitted")).toBe("NEW");
    expect(normalizeAnkorstoreStatus("")).toBe("NEW");
    expect(normalizeAnkorstoreStatus(null)).toBe("NEW");
    expect(normalizeAnkorstoreStatus(undefined)).toBe("NEW");
    expect(normalizeAnkorstoreStatus("something_new_from_ankor")).toBe("NEW");
  });

  it("est insensible à la casse", () => {
    expect(normalizeAnkorstoreStatus("BRAND_PAID")).toBe("SHIPPED");
    expect(normalizeAnkorstoreStatus("Cancelled")).toBe("CANCELLED");
  });
});

describe("ankorstore-orders-api — extractReferenceFromSku", () => {
  it("extrait le préfixe avant le premier underscore", () => {
    expect(extractReferenceFromSku("PRT35_blanc_iz0dtf3t")).toBe("PRT35");
    expect(extractReferenceFromSku("A1623E_GOLDEN_TU")).toBe("A1623E");
    expect(extractReferenceFromSku("G23_BLANC_S")).toBe("G23");
  });

  it("retourne null pour sku vide ou trop court", () => {
    expect(extractReferenceFromSku(null)).toBeNull();
    expect(extractReferenceFromSku(undefined)).toBeNull();
    expect(extractReferenceFromSku("")).toBeNull();
    expect(extractReferenceFromSku("  ")).toBeNull();
    // Un caractère seul = pas une référence valide.
    expect(extractReferenceFromSku("A_couleur")).toBeNull();
  });

  it("accepte un SKU sans underscore comme référence complète", () => {
    expect(extractReferenceFromSku("PRT35")).toBe("PRT35");
  });

  it("ignore les espaces autour", () => {
    expect(extractReferenceFromSku("  PRT35_blanc  ")).toBe("PRT35");
  });
});

describe("ankorstore-orders-api — ankorstoreCentsToEuros", () => {
  it("convertit les centimes en euros", () => {
    expect(ankorstoreCentsToEuros(24744)).toBe(247.44);
    expect(ankorstoreCentsToEuros(2400)).toBe(24);
    expect(ankorstoreCentsToEuros(0)).toBe(0);
  });

  it("gère null, undefined, NaN comme 0", () => {
    expect(ankorstoreCentsToEuros(null)).toBe(0);
    expect(ankorstoreCentsToEuros(undefined)).toBe(0);
    expect(ankorstoreCentsToEuros(NaN)).toBe(0);
  });

  it("arrondit les centimes à l'entier avant division (aucune perte flottante)", () => {
    // Ankor devrait toujours renvoyer des entiers, mais on se blinde contre un float parasite.
    expect(ankorstoreCentsToEuros(2400.4)).toBe(24);
    expect(ankorstoreCentsToEuros(2400.6)).toBe(24.01);
  });

  it("gère les montants négatifs (billing items : frais soustraits)", () => {
    expect(ankorstoreCentsToEuros(-742)).toBe(-7.42);
  });
});

describe("ankorstore-orders-api — extractTrackingInfo", () => {
  it("retourne des null si overview est absent", () => {
    const r = extractTrackingInfo(null);
    expect(r.trackingNumber).toBeNull();
    expect(r.trackingLink).toBeNull();
    expect(r.status).toBeNull();
    expect(r.updatedAt).toBeNull();
  });

  it("privilégie parcels[0].trackedPackage quand disponible", () => {
    const r = extractTrackingInfo({
      parcels: [
        {
          trackedPackage: {
            trackingNumber: "XX101221350JB",
            trackingLink: "https://chronopost.fr/track",
            currentStatus: {
              status: "DELIVERED",
              statusDetails: "Delivered",
              updatedAt: "2026-07-10T11:44:55+00:00",
            },
          },
        },
      ],
      transaction: {
        tracking: {
          trackingNumber: "DIFFERENT",
          trackingLink: "http://other",
          currentStatus: { status: "IN_TRANSIT" },
        },
      },
    });
    expect(r.trackingNumber).toBe("XX101221350JB");
    expect(r.trackingLink).toBe("https://chronopost.fr/track");
    expect(r.status).toBe("DELIVERED");
    expect(r.statusDetails).toBe("Delivered");
    expect(r.updatedAt).toBeInstanceOf(Date);
    expect(r.updatedAt?.toISOString()).toBe("2026-07-10T11:44:55.000Z");
  });

  it("retombe sur transaction.tracking si parcels absent", () => {
    const r = extractTrackingInfo({
      transaction: {
        tracking: {
          trackingNumber: "TX123",
          trackingLink: "http://tx",
          currentStatus: { status: "IN_TRANSIT" },
        },
      },
    });
    expect(r.trackingNumber).toBe("TX123");
    expect(r.status).toBe("IN_TRANSIT");
  });

  it("retombe sur overview.tracking top-level si les autres sont absents", () => {
    const r = extractTrackingInfo({
      tracking: {
        number: "TOP123",
        link: "http://top",
      },
    });
    expect(r.trackingNumber).toBe("TOP123");
    expect(r.trackingLink).toBe("http://top");
    expect(r.status).toBeNull();
  });
});
