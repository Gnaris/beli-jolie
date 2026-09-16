/**
 * Statut « visible » d'une commande — dérivé de (status, paymentStatus, paymentMode).
 *
 * On expose 4 états métier à la cliente et à ses acheteuses :
 *   - WAITING_PAYMENT : virement en attente
 *   - PAID            : payé, en préparation (carte OK ou virement confirmé)
 *   - SHIPPED         : expédié
 *   - CANCELLED       : annulé
 *
 * Rien ne change en base : `OrderStatus` reste PENDING|SHIPPED|CANCELLED,
 * `paymentStatus` reste pending|paid|failed. Ce helper est la seule source
 * de vérité pour le libellé affiché.
 */

export type OrderVisibleStatus = "WAITING_PAYMENT" | "PAID" | "SHIPPED" | "CANCELLED";

export interface OrderStatusInput {
  status: string; // OrderStatus (PENDING | SHIPPED | CANCELLED)
  paymentStatus?: string | null; // "pending" | "paid" | "failed" | "refunded" | ...
  paymentMode?: string | null;   // "CARD" | "BANK_TRANSFER" | null (historique = CARD)
}

export function getOrderVisibleStatus(order: OrderStatusInput): OrderVisibleStatus {
  if (order.status === "CANCELLED") return "CANCELLED";
  if (order.status === "SHIPPED") return "SHIPPED";

  // À partir d'ici status === "PENDING" (nouveau) : on distingue selon le paiement.
  const isBankTransfer = order.paymentMode === "BANK_TRANSFER";
  const isPaid = order.paymentStatus === "paid";

  if (isBankTransfer && !isPaid) return "WAITING_PAYMENT";
  return "PAID"; // carte payée OU virement confirmé
}

export interface VisibleStatusLabels {
  fr: string;
  en: string;
}

export const VISIBLE_STATUS_LABELS: Record<OrderVisibleStatus, VisibleStatusLabels> = {
  WAITING_PAYMENT: { fr: "En attente de paiement", en: "Awaiting payment" },
  PAID:            { fr: "Paiement reçu",           en: "Payment received" },
  SHIPPED:         { fr: "Expédiée",                en: "Shipped" },
  CANCELLED:       { fr: "Annulée",                 en: "Cancelled" },
};

export function getVisibleStatusLabel(
  status: OrderVisibleStatus,
  locale: "fr" | "en" = "fr",
): string {
  return VISIBLE_STATUS_LABELS[status][locale];
}
