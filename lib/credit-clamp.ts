import { roundCent } from "./money";

/**
 * Clamp le montant d'avoir demandé par la cliente aux limites serveur :
 *   min(solde réel, total TTC, montant demandé) — puis arrondi au centime.
 *
 * Utilisé par cart-pricing (aperçu récap), create-intent (montant Stripe),
 * placeOrder/placeBankTransferOrder/placePaymentLinkOrder (pose de
 * Order.creditApplied). Un seul point de vérité pour éviter toute divergence
 * entre l'affichage récap et le montant réellement débité du portefeuille.
 */
export function clampCreditToApply(params: {
  availableCredit: number;
  totalTTC: number;
  requested: number;
}): { creditApplied: number; amountDue: number; amountDueCents: number } {
  const requested = Math.max(0, Number(params.requested ?? 0));
  const creditApplied = roundCent(
    Math.min(
      Math.max(0, params.availableCredit),
      Math.max(0, params.totalTTC),
      requested,
    ),
  );
  const amountDue = Math.max(0, roundCent(params.totalTTC - creditApplied));
  return {
    creditApplied,
    amountDue,
    amountDueCents: Math.round(amountDue * 100),
  };
}
