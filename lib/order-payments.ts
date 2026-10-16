/**
 * Helpers autour de la table OrderPayment : lecture, création, annulation et
 * recalcul de la balance « Reste à régler / Avoir à rembourser ».
 */
import { prisma } from "@/lib/prisma";
import { roundCent } from "@/lib/money";

/**
 * Le client Prisma est étendu (`$extends` scope tenant) : son type résolu ne
 * matche pas `PrismaClient` nu, et une union `TransactionClient | typeof prisma`
 * casse l'inférence des méthodes. Comme ces helpers sont internes et validés
 * par les tests, on accepte un `any` typé juste assez pour l'ergonomie.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface OrderPaymentView {
  id: string;
  kind: "INITIAL" | "SUPPLEMENT";
  method: "CARD" | "STRIPE_LINK" | "BANK_TRANSFER" | "PAY_ON_PICKUP" | "CREDIT";
  status: "PENDING" | "PAID" | "CANCELLED";
  amount: number;
  stripeCheckoutUrl: string | null;
  stripeExpiresAt: Date | null;
  paidAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  note: string | null;
}

/** Liste des paiements d'une commande, triée par ordre chronologique. */
export async function listOrderPayments(
  orderId: string,
  tx: Tx = prisma,
): Promise<OrderPaymentView[]> {
  const rows = (await tx.orderPayment.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any[];
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind as "INITIAL" | "SUPPLEMENT",
    method: p.method as OrderPaymentView["method"],
    status: p.status as OrderPaymentView["status"],
    amount: Number(p.amount),
    stripeCheckoutUrl: p.stripeCheckoutUrl,
    stripeExpiresAt: p.stripeExpiresAt,
    paidAt: p.paidAt,
    confirmedAt: p.confirmedAt,
    createdAt: p.createdAt,
    note: p.note,
  }));
}

/**
 * Somme TTC des paiements PAID — base de calcul du « déjà encaissé ».
 * On exclut les COMMERCIAL_GIFT : ce ne sont pas des encaissements, mais la
 * trace d'un dépassement absorbé par la boutique (remise offerte). Depuis
 * 2026-10-16 ils sont représentés par `Order.commercialGiftHT` ; le filtre
 * reste pour couvrir les enregistrements historiques pré-migration.
 */
export async function sumPaidTTC(orderId: string, tx: Tx = prisma): Promise<number> {
  const agg = await tx.orderPayment.aggregate({
    where: {
      orderId,
      status: "PAID",
      method: { not: "COMMERCIAL_GIFT" },
    },
    _sum: { amount: true },
  });
  return roundCent(Number(agg._sum.amount ?? 0));
}

/**
 * Annule tous les SUPPLEMENT PENDING de la commande. Appelé avant de créer un
 * nouveau lien pour éviter que la cliente puisse régler un ancien montant qui
 * ne correspond plus à la commande modifiée. Tente également d'expirer la
 * Checkout Session Stripe correspondante (best-effort) pour que le lien
 * tombe immédiatement côté hébergé si la cliente l'a encore ouvert.
 */
export async function cancelPendingSupplements(orderId: string, tx: Tx = prisma): Promise<number> {
  // Récupère d'abord les sessions Stripe à expirer AVANT le passage en CANCELLED.
  const sessionsToExpire = await tx.orderPayment.findMany({
    where: {
      orderId,
      kind: "SUPPLEMENT",
      status: "PENDING",
      stripeCheckoutSessionId: { not: null },
    },
    select: { stripeCheckoutSessionId: true },
  });

  const res = await tx.orderPayment.updateMany({
    where: { orderId, kind: "SUPPLEMENT", status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  // Best-effort : on expire les Checkout Session Stripe en fire-and-forget.
  // Hors de la transaction DB — on ne bloque pas la mutation si Stripe est
  // indispo ou si la session est déjà fermée (ex. déjà payée côté Stripe).
  if (sessionsToExpire.length > 0) {
    void (async () => {
      try {
        const { getStripeInstance } = await import("@/lib/stripe");
        const stripe = await getStripeInstance();
        await Promise.all(
          (sessionsToExpire as Array<{ stripeCheckoutSessionId: string | null }>)
            .filter((s) => !!s.stripeCheckoutSessionId)
            .map((s) =>
              stripe.checkout.sessions
                .expire(s.stripeCheckoutSessionId as string)
                .catch(() => {
                  /* session déjà expirée / payée / inexistante — silencieux. */
                }),
            ),
        );
      } catch {
        // Stripe non configuré ou erreur système — on laisse le CANCELLED en DB.
      }
    })();
  }

  return res.count;
}

/** Un SUPPLEMENT PENDING actif (max 1 à la fois) — pour l'UI client. */
export async function findActivePendingSupplement(
  orderId: string,
  tx: Tx = prisma,
): Promise<OrderPaymentView | null> {
  const row = await tx.orderPayment.findFirst({
    where: { orderId, kind: "SUPPLEMENT", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    kind: "SUPPLEMENT",
    method: row.method as OrderPaymentView["method"],
    status: "PENDING",
    amount: Number(row.amount),
    stripeCheckoutUrl: row.stripeCheckoutUrl,
    stripeExpiresAt: row.stripeExpiresAt,
    paidAt: row.paidAt,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    note: row.note,
  };
}

/**
 * Marque un paiement PAID et retourne le nouveau total encaissé.
 * Met également à jour `Order.paymentStatus = "paid"` quand la commande est
 * désormais entièrement couverte (encaissé >= TTC courant).
 */
export async function markOrderPaymentPaid(
  paymentId: string,
  options: { confirmedBy?: string | null; paidAt?: Date; stripePaymentIntentId?: string | null } = {},
  tx: Tx = prisma,
): Promise<{ orderId: string; paidTTC: number }> {
  const payment = await tx.orderPayment.update({
    where: { id: paymentId },
    data: {
      status: "PAID",
      paidAt: options.paidAt ?? new Date(),
      confirmedAt: options.confirmedBy ? new Date() : undefined,
      confirmedBy: options.confirmedBy ?? undefined,
      stripePaymentIntentId: options.stripePaymentIntentId ?? undefined,
    },
    select: { orderId: true },
  });

  const paidTTC = await sumPaidTTC(payment.orderId, tx);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: payment.orderId },
    select: { totalTTC: true, paymentStatus: true },
  });
  const totalTTC = Number(order.totalTTC);

  // Dès que le TTC est couvert, on bascule paymentStatus sur "paid" (facilite
  // les filtres existants et l'UI).
  if (paidTTC + 0.01 >= totalTTC && order.paymentStatus !== "paid") {
    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: "paid" },
    });
  }

  return { orderId: payment.orderId, paidTTC };
}

/**
 * Balance de la commande en se basant sur la somme réelle des OrderPayment PAID.
 * Si aucun OrderPayment n'existe encore (commandes historiques pre-backfill),
 * on retombe sur le TTC payé reconstruit depuis `paidSubtotalHT` + port + TVA.
 */
export function computeOrderBalanceAmounts(args: {
  newTotalTTC: number;
  paidTotalTTC: number;
}): { remainingToPay: number; creditToRefund: number } {
  return {
    remainingToPay: Math.max(0, roundCent(args.newTotalTTC - args.paidTotalTTC)),
    creditToRefund: Math.max(0, roundCent(args.paidTotalTTC - args.newTotalTTC)),
  };
}
