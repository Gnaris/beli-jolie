/**
 * Fallback adresse société : quand la cliente commande en retrait boutique ou
 * transporteur privé sans adresse de livraison enregistrée, on synthétise une
 * adresse depuis les champs `address*` du User.
 */
import { describe, it, expect } from "vitest";
import {
  buildFallbackAddressFromUser,
  isFallbackAddressAllowed,
} from "@/lib/order-address-fallback";

const completeUser = {
  firstName: "Marie",
  lastName: "Durand",
  company: "Boutique ACME",
  phone: "0102030405",
  addressStreet: "12 rue des Lilas",
  addressComplement: "Bâtiment B",
  addressZip: "75011",
  addressCity: "Paris",
  addressCountry: "FR",
};

describe("isFallbackAddressAllowed", () => {
  it("autorise retrait boutique et transporteur privé", () => {
    expect(isFallbackAddressAllowed("pickup")).toBe(true);
    expect(isFallbackAddressAllowed("private")).toBe(true);
  });

  it("refuse livraison classique et fusion", () => {
    expect(isFallbackAddressAllowed("delivery")).toBe(false);
    expect(isFallbackAddressAllowed("merge")).toBe(false);
    expect(isFallbackAddressAllowed(undefined)).toBe(false);
    expect(isFallbackAddressAllowed(null)).toBe(false);
  });
});

describe("buildFallbackAddressFromUser", () => {
  it("construit une adresse complète à partir des champs société", () => {
    const addr = buildFallbackAddressFromUser(completeUser);
    expect(addr).not.toBeNull();
    expect(addr).toMatchObject({
      id: "billing_fallback",
      firstName: "Marie",
      lastName: "Durand",
      company: "Boutique ACME",
      address1: "12 rue des Lilas",
      address2: "Bâtiment B",
      zipCode: "75011",
      city: "Paris",
      country: "FR",
      phone: "0102030405",
    });
  });

  it("retourne null si la rue société est vide", () => {
    expect(
      buildFallbackAddressFromUser({ ...completeUser, addressStreet: "" }),
    ).toBeNull();
    expect(
      buildFallbackAddressFromUser({ ...completeUser, addressStreet: null }),
    ).toBeNull();
  });

  it("retourne null si le code postal, la ville ou le pays sont vides", () => {
    expect(
      buildFallbackAddressFromUser({ ...completeUser, addressZip: "" }),
    ).toBeNull();
    expect(
      buildFallbackAddressFromUser({ ...completeUser, addressCity: null }),
    ).toBeNull();
    expect(
      buildFallbackAddressFromUser({ ...completeUser, addressCountry: "   " }),
    ).toBeNull();
  });

  it("tolère les champs optionnels vides (complement, phone, company)", () => {
    const addr = buildFallbackAddressFromUser({
      ...completeUser,
      addressComplement: null,
      phone: null,
      company: null,
    });
    expect(addr).not.toBeNull();
    expect(addr!.address2).toBeNull();
    expect(addr!.phone).toBeNull();
    expect(addr!.company).toBeNull();
  });
});
