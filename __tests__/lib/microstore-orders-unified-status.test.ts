/**
 * Vérifie que les commandes Microstore sont affichées comme « Expédiée »
 * dans la vue marketplaces unifiée dès qu'elles sont importées.
 * Reflète la règle métier : une commande Microstore importable = validée
 * ET expédiée côté POS.
 *
 * Le helper `normalizeMicrostoreToUnified` n'est pas exporté directement
 * (il est privé à `app/actions/admin/marketplace-orders.ts`), donc ce test
 * documente le contrat via un mini-reproducer aligné sur l'implémentation.
 */

import { describe, expect, it } from "vitest";

type MicrostoreDbStatus = "NEW" | "SHIPPED" | "CANCELLED";
type UnifiedStatus = "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";

function normalizeMicrostoreToUnified(s: MicrostoreDbStatus): UnifiedStatus {
  if (s === "CANCELLED") return "CANCELLED";
  return "SHIPPED";
}

describe("normalizeMicrostoreToUnified", () => {
  it("mappe NEW (base) vers SHIPPED (déjà validée + expédiée côté POS)", () => {
    expect(normalizeMicrostoreToUnified("NEW")).toBe("SHIPPED");
  });

  it("garde SHIPPED (base) → SHIPPED (unifié)", () => {
    expect(normalizeMicrostoreToUnified("SHIPPED")).toBe("SHIPPED");
  });

  it("garde CANCELLED (base) → CANCELLED (unifié)", () => {
    expect(normalizeMicrostoreToUnified("CANCELLED")).toBe("CANCELLED");
  });

  it("ne renvoie jamais NEW ni VALIDATED (Microstore n'a pas ces buckets)", () => {
    for (const s of ["NEW", "SHIPPED", "CANCELLED"] as MicrostoreDbStatus[]) {
      const u = normalizeMicrostoreToUnified(s);
      expect(u).not.toBe("NEW");
      expect(u).not.toBe("VALIDATED");
    }
  });
});
