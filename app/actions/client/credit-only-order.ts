"use server";

import {
  placeBankTransferOrder,
  type BankTransferOrderInput,
  type BankTransferOrderResult,
  type BankTransferOrderError,
} from "./bank-transfer-order";

/**
 * Commande 100 % réglée par avoir (crédit) — aucun débit externe.
 *
 * Réutilise le pipeline de `placeBankTransferOrder` (mêmes vérifs stock,
 * min. commande, promos, etc.) mais force :
 *   - paymentMode   = "CREDIT"
 *   - paymentStatus = "paid" (immédiat)
 *   - mail client   = "ORDER_CREATED" (pas de coordonnées IBAN)
 *   - bypass check bank-transfer enabled
 *   - garde-fou : refuse si le crédit ne couvre pas 100 % du TTC.
 *
 * La cliente ne peut pas passer par ce chemin depuis le UI si `amountDue > 0`
 * (le composant Step3PaymentContent le masque). Le serveur reste souverain
 * grâce au clamp + à la vérif "creditApplied >= totalTTC - 0.01".
 */
export type CreditOnlyOrderInput = Omit<BankTransferOrderInput, "_creditOnlyMode">;

export async function placeCreditOnlyOrder(
  input: CreditOnlyOrderInput,
): Promise<BankTransferOrderResult | BankTransferOrderError> {
  return placeBankTransferOrder({ ...input, _creditOnlyMode: true });
}
