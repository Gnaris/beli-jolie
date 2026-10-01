import { describe, it, expect } from "vitest";
import { isTransientBrowserError } from "@/lib/transient-browser-errors";

describe("isTransientBrowserError", () => {
  describe("messages reconnus comme transients (Safari Translate / iOS backgrounding)", () => {
    it("détecte le message Safari IndexedDB / MessageChannel détruit", () => {
      expect(isTransientBrowserError("The object can not be found here.")).toBe(true);
    });

    it("détecte le même message avec casse différente", () => {
      expect(isTransientBrowserError("THE OBJECT CAN NOT BE FOUND HERE")).toBe(true);
    });

    it("détecte 'Load failed' (Safari fetch avorté)", () => {
      expect(isTransientBrowserError("Load failed")).toBe(true);
    });

    it("détecte 'The operation was aborted'", () => {
      expect(isTransientBrowserError("The operation was aborted.")).toBe(true);
    });

    it("détecte AbortError bare", () => {
      expect(isTransientBrowserError("AbortError: aborted")).toBe(true);
    });

    it("détecte 'The operation is insecure'", () => {
      expect(isTransientBrowserError("SecurityError: The operation is insecure.")).toBe(true);
    });

    it("détecte 'network connection was lost' iOS", () => {
      expect(isTransientBrowserError("The network connection was lost.")).toBe(true);
    });
  });

  describe("messages NON transients (vrais bugs applicatifs)", () => {
    it("ne confond pas une erreur SQL", () => {
      expect(isTransientBrowserError("Unique constraint failed on 'email'")).toBe(false);
    });

    it("ne confond pas une erreur de validation Zod", () => {
      expect(isTransientBrowserError("Required field missing: addressId")).toBe(false);
    });

    it("ne confond pas une erreur Stripe métier", () => {
      expect(isTransientBrowserError("Your card was declined")).toBe(false);
    });

    it("ne confond pas une erreur de rendu React", () => {
      expect(isTransientBrowserError("Cannot read properties of undefined (reading 'price')")).toBe(false);
    });

    it("ne confond pas un TypeError générique", () => {
      expect(isTransientBrowserError("TypeError: foo.bar is not a function")).toBe(false);
    });
  });

  describe("entrées limites", () => {
    it("renvoie false pour message vide", () => {
      expect(isTransientBrowserError("")).toBe(false);
    });

    it("renvoie false pour undefined", () => {
      expect(isTransientBrowserError(undefined)).toBe(false);
    });

    it("renvoie false pour null", () => {
      expect(isTransientBrowserError(null)).toBe(false);
    });
  });
});
