"use server";

/**
 * Server actions pour la relance « Mail Avis » (suivi 10 j après expédition).
 *
 * - Toggle d'activation : SiteConfig `order_followup_review_enabled` ("true"/"false")
 * - Défaut : désactivé (la cliente l'active explicitement une fois le template
 *   personnalisé à son goût).
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { setSiteConfig } from "@/lib/site-config-write";
import { revalidatePath } from "next/cache";
import {
  ORDER_FOLLOWUP_REVIEW_ENABLED_KEY,
  ORDER_FOLLOWUP_REVIEW_DELAY_DAYS,
} from "@/lib/order-followup-config";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Accès non autorisé.");
}

export interface OrderFollowupReviewConfig {
  enabled: boolean;
  delayDays: number;
}

export async function getOrderFollowupReviewConfig(): Promise<OrderFollowupReviewConfig> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: ORDER_FOLLOWUP_REVIEW_ENABLED_KEY },
    select: { value: true },
  });
  return {
    enabled: row?.value === "true",
    delayDays: ORDER_FOLLOWUP_REVIEW_DELAY_DAYS,
  };
}

export async function setOrderFollowupReviewEnabled(enabled: boolean): Promise<{ success: true }> {
  await requireAdmin();
  await setSiteConfig(ORDER_FOLLOWUP_REVIEW_ENABLED_KEY, enabled ? "true" : "false");
  revalidatePath("/admin/contact-client");
  return { success: true };
}

/**
 * Info par client pour la colonne « Suivi commande » :
 *   - `next` : prochain envoi programmé (commande SHIPPED, non follow-upée,
 *              `shippedAt + 10j` en avance ou dépassée) — toujours la plus
 *              proche si plusieurs commandes éligibles.
 *   - `lastSent` : date du dernier mail de suivi effectivement envoyé.
 */
export interface OrderFollowupJobInfo {
  next: { nextAt: Date; orderNumber: string } | null;
  lastSent: { at: Date; orderNumber: string } | null;
}

/**
 * Charge en une passe les infos de suivi commande pour une liste d'utilisateurs.
 * Appelé depuis la Vue Mails /admin/contact-client — un hit DB par scope,
 * pas N+1.
 */
export async function loadOrderFollowupJobsFor(
  userIds: string[],
): Promise<Map<string, OrderFollowupJobInfo>> {
  const map = new Map<string, OrderFollowupJobInfo>();
  if (userIds.length === 0) return map;

  const delayMs = ORDER_FOLLOWUP_REVIEW_DELAY_DAYS * 24 * 60 * 60 * 1000;

  const [pendingOrders, sentOrders] = await Promise.all([
    // Commandes SHIPPED, mail de suivi pas encore envoyé → prochaine
    // échéance par utilisateur (`shippedAt + 10j` ascendant).
    prisma.order.findMany({
      where: {
        userId: { in: userIds },
        status: "SHIPPED",
        reviewRequestEmailSentAt: null,
        shippedAt: { not: null },
      },
      orderBy: { shippedAt: "asc" },
      select: { userId: true, orderNumber: true, shippedAt: true },
    }),
    // Dernier mail déjà parti par utilisateur.
    prisma.order.findMany({
      where: {
        userId: { in: userIds },
        reviewRequestEmailSentAt: { not: null },
      },
      orderBy: { reviewRequestEmailSentAt: "desc" },
      select: { userId: true, orderNumber: true, reviewRequestEmailSentAt: true },
    }),
  ]);

  for (const o of pendingOrders) {
    if (!o.userId || !o.shippedAt) continue;
    const existing = map.get(o.userId);
    if (existing?.next) continue;
    const nextAt = new Date(o.shippedAt.getTime() + delayMs);
    map.set(o.userId, {
      next: { nextAt, orderNumber: o.orderNumber },
      lastSent: existing?.lastSent ?? null,
    });
  }

  for (const o of sentOrders) {
    if (!o.userId || !o.reviewRequestEmailSentAt) continue;
    const existing = map.get(o.userId);
    if (existing?.lastSent) continue;
    map.set(o.userId, {
      next: existing?.next ?? null,
      lastSent: { at: o.reviewRequestEmailSentAt, orderNumber: o.orderNumber },
    });
  }

  return map;
}
