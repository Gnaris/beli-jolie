import { describe, it, expect } from "vitest";
import { normalizeCustomerNote } from "@/lib/normalize-customer-note";

describe("normalizeCustomerNote — filet serveur du commentaire client", () => {
  it("renvoie null quand l'entrée est absente", () => {
    expect(normalizeCustomerNote(undefined)).toBeNull();
    expect(normalizeCustomerNote(null)).toBeNull();
    expect(normalizeCustomerNote("")).toBeNull();
  });

  it("renvoie null quand l'entrée est faite uniquement d'espaces", () => {
    expect(normalizeCustomerNote("   ")).toBeNull();
    expect(normalizeCustomerNote("\n\t  \n")).toBeNull();
  });

  it("trim les espaces de bordure", () => {
    expect(normalizeCustomerNote("  bonjour  ")).toBe("bonjour");
    expect(normalizeCustomerNote("\nmerci de bien emballer\n")).toBe(
      "merci de bien emballer",
    );
  });

  it("laisse passer un commentaire court tel quel", () => {
    expect(normalizeCustomerNote("Livraison avant vendredi stp")).toBe(
      "Livraison avant vendredi stp",
    );
  });

  it("accepte exactement 1000 caractères sans tronquer", () => {
    const n = "a".repeat(1000);
    const out = normalizeCustomerNote(n);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1000);
  });

  it("tronque à 1000 caractères si on dépasse", () => {
    const out = normalizeCustomerNote("x".repeat(1500));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1000);
  });
});
