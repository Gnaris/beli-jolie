/**
 * Helper partagé par les 2 workers de mails automatiques (panier abandonné
 * et inactivité) pour la condition « n'envoyer ce stade que si le client a
 * strictement moins de N commandes ».
 *
 * Règle métier validée avec la cliente (2026-09-25) : le compteur est le
 * nombre de commandes non annulées du client dans le tenant courant, c'est-
 * à-dire OrderStatus IN (PENDING, SHIPPED). Une commande créée mais pas
 * encore expédiée compte : dès qu'un B2B a validé un panier, l'objectif
 * « ne pas le spammer avec une relance » est déjà rempli.
 */

import { prisma } from "@/lib/prisma";
import type { OrderStatus } from "@prisma/client";

const NON_CANCELLED_STATUSES: OrderStatus[] = ["PENDING", "SHIPPED"];

/**
 * Retourne le nombre de commandes non annulées d'un client dans un tenant.
 * Utilisé par le worker panier abandonné (traitement 1 job à la fois).
 */
export async function countNonCancelledOrdersForUser(
  tenantId: string,
  userId: string,
): Promise<number> {
  return prisma.order.count({
    where: {
      tenantId,
      userId,
      status: { in: NON_CANCELLED_STATUSES },
    },
  });
}

/**
 * Batch : retourne une Map userId → count. Utilisé par le worker inactivité
 * qui traite jusqu'à 500 users par tick — faire 500 counts individuels
 * multiplierait le nombre de requêtes SQL.
 * Les userIds absents de la Map ont 0 commande.
 */
export async function countNonCancelledOrdersByUser(
  tenantId: string,
  userIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const rows = await prisma.order.groupBy({
    by: ["userId"],
    where: {
      tenantId,
      userId: { in: userIds },
      status: { in: NON_CANCELLED_STATUSES },
    },
    _count: { _all: true },
  });
  for (const row of rows) {
    map.set(row.userId, row._count._all);
  }
  return map;
}

/**
 * Décide si un stade doit être sauté à cause de son plafond de commandes.
 * Retourne true si le stade doit être IGNORÉ (aucun mail envoyé pour ce
 * stade précis à ce client). Un stade sans plafond (maxOrderCount === null)
 * n'est jamais sauté.
 */
export function shouldSkipStageForOrderCount(
  maxOrderCount: number | null | undefined,
  orderCount: number,
): boolean {
  if (maxOrderCount === null || maxOrderCount === undefined) return false;
  return orderCount >= maxOrderCount;
}
