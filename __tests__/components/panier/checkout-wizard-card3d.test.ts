import { describe, it, expect } from "vitest";

/**
 * Tests de la logique wizard checkout + carte 3D
 *
 * On teste ici les FONCTIONS PURES utilisées par :
 * - components/panier/CardPreview3D.tsx (affichage carte 3D)
 * - components/panier/CheckoutClient.tsx (navigation wizard + Stripe events)
 *
 * On ne teste pas le rendu React (Stripe Elements nécessite un vrai iframe).
 */

// ─── Reproduit lib.brand mapping utilisée dans CheckoutClient ───
// (Stripe renvoie e.brand qui peut être n'importe quel string)
type CardBrand =
  | "unknown" | "visa" | "mastercard" | "amex"
  | "discover" | "diners" | "jcb" | "unionpay";

function normalizeBrand(stripeBrand: string | undefined | null): CardBrand {
  const known: readonly CardBrand[] = [
    "unknown", "visa", "mastercard", "amex",
    "discover", "diners", "jcb", "unionpay",
  ];
  if (!stripeBrand) return "unknown";
  return (known as readonly string[]).includes(stripeBrand)
    ? (stripeBrand as CardBrand)
    : "unknown";
}

// ─── Reproduit le mapping NumberStatus ─────────────────────────
// Stripe onChange event : { empty: boolean, complete: boolean, error?: {...} }
type NumberStatus = "empty" | "partial" | "complete";
type StripeChangeEvent = { empty: boolean; complete: boolean };

function statusFromStripeEvent(e: StripeChangeEvent): NumberStatus {
  if (e.empty) return "empty";
  if (e.complete) return "complete";
  return "partial";
}

// ─── Reproduit le formatage MM/AA affiché sur la carte ─────────
function formatCardExpiryDisplay(expMonth: string, expYear: string): string {
  if (!expMonth && !expYear) return "MM/AA";
  const mm = (expMonth || "").padStart(2, "0").slice(0, 2);
  const yy = (expYear || "").slice(-2).padStart(2, "0");
  return `${mm}/${yy}`;
}

// ─── Reproduit la mise en majuscule du titulaire ───────────────
function formatCardHolderName(input: string): string {
  return (input || "").trim().toUpperCase() || "NOM PRÉNOM";
}

// ─── Reproduit la logique canProceed du wizard (2 étapes après fusion) ──
// Étape 1 « Vos informations » : facturation + adresse livraison + mode/transporteur
// Étape 2 « Paiement » : payment method + CGV
function canProceedFromStep(step: 1 | 2, flags: {
  hasShippingAddress: boolean;
  hasDeliveryMethod: boolean;
  billingComplete: boolean;
  hasPaymentMethod: boolean;
  cgvAccepted: boolean;
}): boolean {
  if (step === 1) return flags.billingComplete && flags.hasShippingAddress && flags.hasDeliveryMethod;
  if (step === 2) return flags.hasPaymentMethod && flags.cgvAccepted;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe("Carte 3D — détection de la marque (Stripe brand)", () => {
  it("mappe 'visa' → 'visa'", () => {
    expect(normalizeBrand("visa")).toBe("visa");
  });
  it("mappe 'mastercard' → 'mastercard'", () => {
    expect(normalizeBrand("mastercard")).toBe("mastercard");
  });
  it("mappe 'amex' → 'amex'", () => {
    expect(normalizeBrand("amex")).toBe("amex");
  });
  it("mappe null / undefined / '' → 'unknown'", () => {
    expect(normalizeBrand(null)).toBe("unknown");
    expect(normalizeBrand(undefined)).toBe("unknown");
    expect(normalizeBrand("")).toBe("unknown");
  });
  it("mappe une marque inconnue → 'unknown' (résilient à un futur retour Stripe)", () => {
    expect(normalizeBrand("carte-bidon-2030")).toBe("unknown");
  });
});

describe("Carte 3D — statut du numéro depuis les events Stripe", () => {
  it("champ vide → 'empty' (16 points gris)", () => {
    expect(statusFromStripeEvent({ empty: true, complete: false })).toBe("empty");
  });
  it("champ complet → 'complete' (16 points pleins)", () => {
    expect(statusFromStripeEvent({ empty: false, complete: true })).toBe("complete");
  });
  it("champ partiellement rempli → 'partial' (points qui pulsent)", () => {
    expect(statusFromStripeEvent({ empty: false, complete: false })).toBe("partial");
  });
  it("champ vide même si Stripe dit complete=false (edge case Stripe)", () => {
    expect(statusFromStripeEvent({ empty: true, complete: true })).toBe("empty");
  });
});

describe("Carte 3D — affichage MM/AA de l'expiration", () => {
  it("vide → 'MM/AA' (placeholder)", () => {
    expect(formatCardExpiryDisplay("", "")).toBe("MM/AA");
  });
  it("mois seul → padded", () => {
    expect(formatCardExpiryDisplay("3", "")).toBe("03/00");
  });
  it("mois + année 4 chiffres → 2 derniers de l'année", () => {
    expect(formatCardExpiryDisplay("12", "2028")).toBe("12/28");
  });
  it("mois + année 2 chiffres → tel quel", () => {
    expect(formatCardExpiryDisplay("07", "26")).toBe("07/26");
  });
});

describe("Carte 3D — affichage du titulaire", () => {
  it("vide → 'NOM PRÉNOM' (placeholder)", () => {
    expect(formatCardHolderName("")).toBe("NOM PRÉNOM");
    expect(formatCardHolderName("   ")).toBe("NOM PRÉNOM");
  });
  it("nom minuscule → MAJUSCULES", () => {
    expect(formatCardHolderName("marie dupont")).toBe("MARIE DUPONT");
  });
  it("nom avec espaces → trim + MAJUSCULES", () => {
    expect(formatCardHolderName("  Marie Dupont  ")).toBe("MARIE DUPONT");
  });
  it("caractères accentués conservés", () => {
    expect(formatCardHolderName("chloé münchen")).toBe("CHLOÉ MÜNCHEN");
  });
});

describe("Wizard checkout — passage d'une étape à la suivante (2 étapes)", () => {
  const complete = {
    hasShippingAddress: true,
    hasDeliveryMethod:  true,
    billingComplete:    true,
    hasPaymentMethod:   true,
    cgvAccepted:        true,
  };

  it("étape 1 (Vos infos) → OK si facturation + adresse + transporteur choisis", () => {
    expect(canProceedFromStep(1, complete)).toBe(true);
  });
  it("étape 1 → BLOQUÉ si facturation incomplète", () => {
    expect(canProceedFromStep(1, { ...complete, billingComplete: false })).toBe(false);
  });
  it("étape 1 → BLOQUÉ si pas d'adresse", () => {
    expect(canProceedFromStep(1, { ...complete, hasShippingAddress: false })).toBe(false);
  });
  it("étape 1 → BLOQUÉ si pas de transporteur", () => {
    expect(canProceedFromStep(1, { ...complete, hasDeliveryMethod: false })).toBe(false);
  });

  it("étape 2 (Paiement) → OK si moyen de paiement choisi ET CGV cochées", () => {
    expect(canProceedFromStep(2, complete)).toBe(true);
  });
  it("étape 2 → BLOQUÉ si CGV non cochées", () => {
    expect(canProceedFromStep(2, { ...complete, cgvAccepted: false })).toBe(false);
  });
  it("étape 2 → BLOQUÉ si pas de moyen de paiement", () => {
    expect(canProceedFromStep(2, { ...complete, hasPaymentMethod: false })).toBe(false);
  });
});
