/**
 * Tests pour lib/onboarding.ts — parseStepsCompleted et logique de lecture.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseStepsCompleted,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from "@/lib/onboarding";

describe("parseStepsCompleted", () => {
  it("renvoie [] si la valeur est null", () => {
    expect(parseStepsCompleted(null)).toEqual([]);
  });

  it("renvoie [] si la valeur est une string vide", () => {
    expect(parseStepsCompleted("")).toEqual([]);
  });

  it("renvoie [] si la valeur n'est pas du JSON valide", () => {
    expect(parseStepsCompleted("pas du JSON")).toEqual([]);
    expect(parseStepsCompleted("{clé:valeur}")).toEqual([]);
  });

  it("renvoie [] si le JSON n'est pas un tableau", () => {
    expect(parseStepsCompleted('{"a":1}')).toEqual([]);
    expect(parseStepsCompleted('"welcome"')).toEqual([]);
    expect(parseStepsCompleted("42")).toEqual([]);
  });

  it("garde uniquement les étapes reconnues", () => {
    const raw = JSON.stringify(["welcome", "company", "inconnu", "brand"]);
    expect(parseStepsCompleted(raw)).toEqual(["welcome", "company", "brand"]);
  });

  it("ignore les entrées non-string", () => {
    const raw = JSON.stringify(["welcome", 42, null, true, "company"]);
    expect(parseStepsCompleted(raw)).toEqual(["welcome", "company"]);
  });

  it("supporte les 8 étapes canoniques", () => {
    const raw = JSON.stringify(ONBOARDING_STEPS);
    const parsed = parseStepsCompleted(raw);
    expect(parsed).toHaveLength(ONBOARDING_STEPS.length);
    for (const step of ONBOARDING_STEPS) {
      expect(parsed).toContain(step);
    }
  });

  it("preserve l'ordre du tableau JSON", () => {
    const raw = JSON.stringify(["email", "welcome", "stripe"]);
    expect(parseStepsCompleted(raw)).toEqual(["email", "welcome", "stripe"]);
  });
});

describe("ONBOARDING_STEPS", () => {
  it("contient bien les 8 étapes attendues dans l'ordre", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "company",
      "brand",
      "stripe",
      "email",
      "shipping",
      "legal",
      "done",
    ]);
  });
});
