/**
 * Verrou anti-fraude carrierPrice (audit checkout §8).
 *
 * `/api/carriers` signe le trio (carrierId, priceCents, transactionId) et
 * `/api/payments/create-intent` doit refuser tout envoi qui casse la signature
 * ou change le prix — sinon un client malicieux pourrait payer 0 € de port.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";

import { signCarrier, verifyCarrierSignature } from "@/lib/carrier-signature";

beforeAll(() => {
  // 32 bytes base64 pour ENCRYPTION_KEY (utilisée comme secret HMAC).
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

describe("carrier signature", () => {
  it("accepte le trio signé avec le prix exact", () => {
    const sig = signCarrier({
      carrierId: "colissimo_home",
      priceCents: 899,
      transactionId: "tx-abc",
    });
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 8.99,
        transactionId: "tx-abc",
        carrierSig: sig,
      }),
    ).toBe(true);
  });

  it("REFUSE quand le prix est bricolé", () => {
    const sig = signCarrier({
      carrierId: "colissimo_home",
      priceCents: 899,
      transactionId: "tx-abc",
    });
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 0,
        transactionId: "tx-abc",
        carrierSig: sig,
      }),
    ).toBe(false);
  });

  it("REFUSE quand le transactionId est faux", () => {
    const sig = signCarrier({
      carrierId: "colissimo_home",
      priceCents: 899,
      transactionId: "tx-abc",
    });
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 8.99,
        transactionId: "tx-XXX",
        carrierSig: sig,
      }),
    ).toBe(false);
  });

  it("REFUSE quand la signature est vide ou tronquée", () => {
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 8.99,
        transactionId: "tx-abc",
        carrierSig: "",
      }),
    ).toBe(false);
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 8.99,
        transactionId: "tx-abc",
        carrierSig: "1234",
      }),
    ).toBe(false);
  });

  it("ACCEPTE pickup_store et private_carrier tant que le prix est 0", () => {
    for (const carrierId of ["pickup_store", "private_carrier"]) {
      expect(
        verifyCarrierSignature({
          carrierId,
          carrierPrice: 0,
          transactionId: "",
          carrierSig: "",
        }),
      ).toBe(true);
      // Prix non-nul → refusé, même sans besoin de sig.
      expect(
        verifyCarrierSignature({
          carrierId,
          carrierPrice: 5,
          transactionId: "",
          carrierSig: "",
        }),
      ).toBe(false);
    }
  });

  it("REFUSE les fallback_* (obsolètes, pas de mécanisme de signature)", () => {
    expect(
      verifyCarrierSignature({
        carrierId: "fallback_pickup",
        carrierPrice: 0,
        transactionId: "",
        carrierSig: "",
      }),
    ).toBe(false);
  });

  it("tolère ±1 centime pour absorber les arrondis IEEE-754", () => {
    const sig = signCarrier({
      carrierId: "colissimo_home",
      priceCents: 1234,
      transactionId: "tx-abc",
    });
    // Le client peut envoyer 12.339999999 au lieu de 12.34 selon le arrondi JS.
    expect(
      verifyCarrierSignature({
        carrierId: "colissimo_home",
        carrierPrice: 12.339999,
        transactionId: "tx-abc",
        carrierSig: sig,
      }),
    ).toBe(true);
  });
});
