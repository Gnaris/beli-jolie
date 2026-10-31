/**
 * lib/order-review-mail-status.ts
 *
 * Calcule l'état de la colonne « Mail Avis » dans /admin/commandes.
 * Pur (0 dépendance) → testable, importable client ou serveur.
 *
 * Un mail de suivi est envoyé automatiquement 10 jours après que la commande
 * est passée au statut SHIPPED. Avant / après / annulation : voir les 5 états.
 */

export type OrderReviewMailStatus =
  | { kind: "none" } // commande pas encore expédiée, ou annulée, ou SHIPPED legacy sans shippedAt
  | { kind: "scheduled"; daysRemaining: number } // envoi programmé dans X j
  | { kind: "imminent" } // envoi au prochain tick scheduler (shippedAt ≥ 10 j, pas encore envoyé)
  | { kind: "sent"; sentAt: Date }; // mail déjà parti

export const REVIEW_MAIL_DELAY_DAYS = 10;

export function computeReviewMailStatus(order: {
  status: string;
  shippedAt: Date | null;
  reviewRequestEmailSentAt: Date | null;
  enabled?: boolean;
}, now: Date = new Date()): OrderReviewMailStatus {
  if (order.reviewRequestEmailSentAt) {
    return { kind: "sent", sentAt: order.reviewRequestEmailSentAt };
  }
  if (order.enabled === false) return { kind: "none" };
  if (order.status !== "SHIPPED") return { kind: "none" };
  if (!order.shippedAt) return { kind: "none" };

  const elapsedMs = now.getTime() - order.shippedAt.getTime();
  const dayMs = 86_400_000;
  const daysRemaining = Math.ceil(REVIEW_MAIL_DELAY_DAYS - elapsedMs / dayMs);
  if (daysRemaining <= 0) return { kind: "imminent" };
  return { kind: "scheduled", daysRemaining };
}
