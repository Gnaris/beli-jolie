import { describe, it, expect } from "vitest";
import {
  isMicrostorePropagationEligible,
  shouldProposeMicrostoreOnFormSave,
} from "@/lib/microstore-propagation-eligibility";

describe("isMicrostorePropagationEligible", () => {
  it("accepte un produit complet dont Microstore est activé", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: true,
        isIncomplete: false,
      }),
    ).toBe(true);
  });

  it("refuse un brouillon même si Microstore est activé (garde principal)", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: true,
        isIncomplete: true,
      }),
    ).toBe(false);
  });

  it("refuse un produit complet dont Microstore est désactivé", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: false,
        isIncomplete: false,
      }),
    ).toBe(false);
  });

  it("refuse quand microstoreEnabled est absent (défensif)", () => {
    expect(isMicrostorePropagationEligible({ isIncomplete: false })).toBe(false);
  });
});

describe("shouldProposeMicrostoreOnFormSave", () => {
  const base = {
    hasMicrostoreConfig: true,
    microstoreEnabledForProduct: true,
    alreadyLinkedToMicrostore: true,
    onlyOrderchampFieldChanged: false,
  };

  it("propose Microstore quand la fiche liée passe en HORS LIGNE (régression 2026-08-28)", () => {
    // Bug historique : `finalStatus !== "OFFLINE"` masquait Microstore lors
    // d'un passage OFFLINE, empêchant le push de `disable=1` vers /goods/update
    // — la fiche restait visible sur la vitrine H5 acheteuses.
    expect(shouldProposeMicrostoreOnFormSave(base)).toBe(true);
  });

  it("propose Microstore quand la fiche liée passe en ARCHIVÉ", () => {
    expect(shouldProposeMicrostoreOnFormSave(base)).toBe(true);
  });

  it("propose Microstore quand la fiche liée passe en LIGNE", () => {
    expect(shouldProposeMicrostoreOnFormSave(base)).toBe(true);
  });

  it("refuse si le produit n'est pas encore lié à Microstore", () => {
    expect(
      shouldProposeMicrostoreOnFormSave({
        ...base,
        alreadyLinkedToMicrostore: false,
      }),
    ).toBe(false);
  });

  it("refuse si Microstore n'est pas configuré côté site", () => {
    expect(
      shouldProposeMicrostoreOnFormSave({
        ...base,
        hasMicrostoreConfig: false,
      }),
    ).toBe(false);
  });

  it("refuse si Microstore est désactivé pour ce produit", () => {
    expect(
      shouldProposeMicrostoreOnFormSave({
        ...base,
        microstoreEnabledForProduct: false,
      }),
    ).toBe(false);
  });

  it("refuse si seul un champ propre à Orderchamp a bougé (autre modale)", () => {
    expect(
      shouldProposeMicrostoreOnFormSave({
        ...base,
        onlyOrderchampFieldChanged: true,
      }),
    ).toBe(false);
  });
});
