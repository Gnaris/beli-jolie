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
  revalidatePath("/admin/marketing");
  return { success: true };
}
