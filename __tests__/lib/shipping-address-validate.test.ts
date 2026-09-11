import { describe, it, expect } from "vitest";
import {
  findMissingAddressFields,
  parseMissingFieldsError,
  serializeMissingFields,
  REQUIRED_ADDRESS_FIELDS,
  ADDRESS_INCOMPLETE_PREFIX,
} from "@/lib/shipping-address-validate";

describe("findMissingAddressFields", () => {
  const complete = {
    firstName: "Jean",
    lastName:  "Dupont",
    address1:  "12 rue des Fleurs",
    zipCode:   "75001",
    city:      "Paris",
    country:   "FR",
  };

  it("retourne vide quand tous les champs sont remplis", () => {
    expect(findMissingAddressFields(complete)).toEqual([]);
  });

  it("détecte la ville vide (cas Slovaquie 27BVT7AF)", () => {
    expect(findMissingAddressFields({ ...complete, city: "" })).toEqual(["city"]);
  });

  it("détecte la ville uniquement composée d'espaces", () => {
    expect(findMissingAddressFields({ ...complete, city: "   " })).toEqual(["city"]);
  });

  it("détecte plusieurs champs manquants dans l'ordre canonique", () => {
    const missing = findMissingAddressFields({
      firstName: "Jean",
      lastName:  "",
      address1:  "",
      zipCode:   "75001",
      city:      "",
      country:   "FR",
    });
    expect(missing).toEqual(["lastName", "address1", "city"]);
  });

  it("détecte les valeurs null/undefined comme manquantes", () => {
    const missing = findMissingAddressFields({
      firstName: null,
      lastName:  undefined,
      address1:  "12 rue X",
      zipCode:   "75001",
      city:      "Paris",
      country:   "FR",
    });
    expect(missing).toEqual(["firstName", "lastName"]);
  });

  it("ne considère PAS company/address2/phone comme obligatoires", () => {
    // La liste des champs obligatoires ne doit contenir que les 6 clés
    // strictement nécessaires pour un bordereau Easy-Express / Smarty365.
    expect(REQUIRED_ADDRESS_FIELDS).toEqual([
      "firstName",
      "lastName",
      "address1",
      "zipCode",
      "city",
      "country",
    ]);
  });
});

describe("serializeMissingFields / parseMissingFieldsError", () => {
  it("round-trip d'une liste de champs", () => {
    const msg = serializeMissingFields(["city", "zipCode"]);
    expect(msg.startsWith(ADDRESS_INCOMPLETE_PREFIX)).toBe(true);
    expect(parseMissingFieldsError(msg)).toEqual(["city", "zipCode"]);
  });

  it("retourne null si le message ne correspond pas au préfixe", () => {
    expect(parseMissingFieldsError("Adresse introuvable.")).toBeNull();
    expect(parseMissingFieldsError("")).toBeNull();
    expect(parseMissingFieldsError(null)).toBeNull();
  });

  it("filtre les valeurs inconnues qui ne sont pas des champs valides", () => {
    const msg = `${ADDRESS_INCOMPLETE_PREFIX}city,foobar,zipCode`;
    expect(parseMissingFieldsError(msg)).toEqual(["city", "zipCode"]);
  });

  it("gère un message sans champs (préfixe seul)", () => {
    expect(parseMissingFieldsError(ADDRESS_INCOMPLETE_PREFIX)).toEqual([]);
  });
});
