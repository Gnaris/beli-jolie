import { describe, it, expect } from "vitest";
import {
  isBillingComplete,
  findAddressMatchingBilling,
  type BillingFields,
  type ShippingAddressLike,
} from "@/lib/shipping-billing-match";

function makeUser(overrides: Partial<BillingFields> = {}): BillingFields {
  return {
    addressStreet:     "12 rue des Lilas",
    addressComplement: null,
    addressZip:        "75001",
    addressCity:       "Paris",
    addressCountry:    "FR",
    ...overrides,
  };
}

function makeAddr(overrides: Partial<ShippingAddressLike> = {}): ShippingAddressLike {
  return {
    id:       "a1",
    address1: "12 rue des Lilas",
    address2: null,
    zipCode:  "75001",
    city:     "Paris",
    country:  "FR",
    ...overrides,
  };
}

describe("isBillingComplete", () => {
  it("retourne true quand rue, code postal et ville sont remplis", () => {
    expect(isBillingComplete(makeUser())).toBe(true);
  });

  it("retourne false quand la rue est manquante", () => {
    expect(isBillingComplete(makeUser({ addressStreet: null }))).toBe(false);
  });

  it("retourne false quand le code postal est manquant", () => {
    expect(isBillingComplete(makeUser({ addressZip: null }))).toBe(false);
  });

  it("retourne false quand la ville est manquante", () => {
    expect(isBillingComplete(makeUser({ addressCity: null }))).toBe(false);
  });

  it("retourne false quand la rue est une chaîne vide", () => {
    expect(isBillingComplete(makeUser({ addressStreet: "" }))).toBe(false);
  });
});

describe("findAddressMatchingBilling", () => {
  it("trouve une adresse identique exacte", () => {
    const match = findAddressMatchingBilling(makeUser(), [makeAddr()]);
    expect(match?.id).toBe("a1");
  });

  it("matche en ignorant la casse et les espaces autour", () => {
    const user = makeUser({
      addressStreet: "  12 RUE des Lilas ",
      addressCity:   "PARIS",
    });
    const match = findAddressMatchingBilling(user, [makeAddr()]);
    expect(match?.id).toBe("a1");
  });

  it("traite null et chaîne vide comme équivalents pour le complément", () => {
    const user = makeUser({ addressComplement: "" });
    const match = findAddressMatchingBilling(user, [makeAddr({ address2: null })]);
    expect(match?.id).toBe("a1");
  });

  it("ne matche pas quand le code postal diffère", () => {
    const match = findAddressMatchingBilling(makeUser(), [makeAddr({ zipCode: "75002" })]);
    expect(match).toBeNull();
  });

  it("ne matche pas quand le pays diffère", () => {
    const match = findAddressMatchingBilling(makeUser(), [makeAddr({ country: "BE" })]);
    expect(match).toBeNull();
  });

  it("retourne null quand la facturation est incomplète", () => {
    const user = makeUser({ addressStreet: null });
    const match = findAddressMatchingBilling(user, [makeAddr()]);
    expect(match).toBeNull();
  });

  it("utilise FR par défaut quand le pays facturation est null", () => {
    const user = makeUser({ addressCountry: null });
    const match = findAddressMatchingBilling(user, [makeAddr({ country: "FR" })]);
    expect(match?.id).toBe("a1");
  });

  it("retourne le premier match quand plusieurs adresses correspondent", () => {
    const addresses = [
      makeAddr({ id: "a1" }),
      makeAddr({ id: "a2" }),
    ];
    const match = findAddressMatchingBilling(makeUser(), addresses);
    expect(match?.id).toBe("a1");
  });

  it("retourne null sur une liste d'adresses vide", () => {
    const match = findAddressMatchingBilling(makeUser(), []);
    expect(match).toBeNull();
  });

  it("différencie deux adresses qui ne diffèrent que par le complément", () => {
    const user = makeUser({ addressComplement: "Bât. B" });
    const a = makeAddr({ id: "a1", address2: "Bât. A" });
    const b = makeAddr({ id: "a2", address2: "Bât. B" });
    const match = findAddressMatchingBilling(user, [a, b]);
    expect(match?.id).toBe("a2");
  });
});
