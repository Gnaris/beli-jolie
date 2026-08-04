"use server";

/**
 * Server actions pour la page /admin/emails (4 scénarios).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import type { EmailScenarioKey } from "@prisma/client";
import {
  setAbandonedCartConfig,
  setInactiveClientConfig,
  setScenarioEnabled,
  getOrCreateScenario,
  type InactiveClientConfig,
} from "@/lib/email-marketing/scenarios";
import { runAbandonedCartScan } from "@/lib/email-marketing/abandoned-cart";
import { runInactiveClientScan } from "@/lib/email-marketing/inactive-client";
import { renderInactiveClientEmail } from "@/lib/email-marketing/templates/inactive-client";
import {
  dispatchPendingRestockEvents,
  getPendingRestockSummary,
} from "@/lib/email-marketing/back-in-stock";
import { sendMail } from "@/lib/email";
import {
  renderAbandonedCartEmail,
  type AbandonedCartItemView,
} from "@/lib/email-marketing/templates/abandoned-cart";
import { renderBackInStockDigestEmail } from "@/lib/email-marketing/templates/back-in-stock-digest";
import { renderWelcomeEmail } from "@/lib/email-marketing/templates/welcome";
import {
  sendNewsletterTest,
  sendNewsletterCampaign,
  type NewsletterCampaign,
} from "@/lib/email-marketing/newsletter";
import { encodeUnsubscribeToken } from "@/lib/email-marketing/tokens";
import { getTenantBaseUrl } from "@/lib/email-marketing/tenant-domain";
import { logger } from "@/lib/logger";

type ActionResult = { success: true } | { success: false; error: string };

// ─────────────────────────────────────────────────────────────
// Toggles
// ─────────────────────────────────────────────────────────────

export async function toggleScenario(
  key: EmailScenarioKey,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    await setScenarioEnabled(tenant.id, key, enabled);
    revalidatePath("/admin/emails");
    return { success: true };
  } catch (err) {
    logger.error("[EmailScenarios] toggleScenario", { key, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Config panier abandonné
// ─────────────────────────────────────────────────────────────

export async function updateAbandonedCartReminders(
  reminderHours: number[],
): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const clean = reminderHours
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 24 * 90);
    if (clean.length === 0) {
      return { success: false, error: "Il faut au moins un délai valide." };
    }
    await setAbandonedCartConfig(tenant.id, {
      reminders: clean.map((h) => ({ afterHours: h })),
    });
    revalidatePath("/admin/emails");
    return { success: true };
  } catch (err) {
    logger.error("[EmailScenarios] updateAbandonedCartReminders", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Scans manuels
// ─────────────────────────────────────────────────────────────

export async function triggerAbandonedCartScanNow(): Promise<
  ActionResult & { scanned?: number; sent?: number; skipped?: number; errors?: number }
> {
  try {
    const { tenant } = await requireAdmin();
    const res = await runAbandonedCartScan(tenant.id);
    revalidatePath("/admin/emails");
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Config client inactif
// ─────────────────────────────────────────────────────────────

export async function updateInactiveClientConfigAction(
  cfg: InactiveClientConfig,
): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const inactiveAfterDays = Math.round(Number(cfg.inactiveAfterDays));
    const cooldownDays = Math.round(Number(cfg.cooldownDays));
    if (!Number.isFinite(inactiveAfterDays) || inactiveAfterDays < 7) {
      return { success: false, error: "Le délai d'inactivité doit être d'au moins 7 jours." };
    }
    if (!Number.isFinite(cooldownDays) || cooldownDays < inactiveAfterDays) {
      return {
        success: false,
        error: "Le délai avant nouvelle relance doit être supérieur ou égal au délai d'inactivité.",
      };
    }
    await setInactiveClientConfig(tenant.id, { inactiveAfterDays, cooldownDays });
    revalidatePath("/admin/emails");
    return { success: true };
  } catch (err) {
    logger.error("[EmailScenarios] updateInactiveClientConfig", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

export async function triggerInactiveClientScanNow(): Promise<
  ActionResult & { scanned?: number; sent?: number; skipped?: number; errors?: number }
> {
  try {
    const { tenant } = await requireAdmin();
    const res = await runInactiveClientScan(tenant.id);
    revalidatePath("/admin/emails");
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Envoie MAINTENANT les notifications "retour en stock" en attente.
 * Chaque client concerné reçoit 1 seul email récap avec la liste de ses
 * favoris qui viennent de repasser en stock.
 */
export async function dispatchBackInStockNow(): Promise<
  ActionResult & {
    productsDispatched?: number;
    clientsNotified?: number;
    emailsSent?: number;
    emailsSkipped?: number;
    emailsErrors?: number;
  }
> {
  try {
    const { tenant } = await requireAdmin();
    const res = await dispatchPendingRestockEvents(tenant.id);
    revalidatePath("/admin/emails");
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Aperçu de la file d'attente retour en stock (widget + page admin).
 */
export async function getBackInStockPending(): Promise<{
  events: number;
  distinctProducts: number;
  eligibleClients: number;
}> {
  const { tenant } = await requireAdmin();
  return await getPendingRestockSummary(tenant.id);
}

// ─────────────────────────────────────────────────────────────
// Envois de test (aperçu réel dans une boîte mail)
// ─────────────────────────────────────────────────────────────

export async function sendAbandonedCartTest(toEmail: string): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const target = toEmail?.trim();
    if (!target) return { success: false, error: "Email destinataire requis." };
    const baseUrl = await getTenantBaseUrl(tenant.id);
    const items: AbandonedCartItemView[] = [
      { productName: "Bague acier fleur émaillée", reference: "BAG-2451", colorName: "Rose", quantity: 6, linePriceLabel: "18,00 €", imageUrl: null, fallbackInitial: "B" },
      { productName: "Collier chaîne fine dorée", reference: "COL-1187", colorName: "Doré", quantity: 12, linePriceLabel: "36,00 €", imageUrl: null, fallbackInitial: "C" },
    ];
    const unsubToken = encodeUnsubscribeToken(tenant.id, target, "CART_REMINDERS");
    const { subject, html } = renderAbandonedCartEmail({
      customerFirstName: "Marie",
      items,
      totalLabel: "54,00 €",
      itemCount: 18,
      resumeUrl: `${baseUrl}/panier`,
      unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
      companyLegal: tenant.name,
      reminderIndex: 0,
    });
    const result = await sendMail({ to: target, subject: `[TEST] ${subject}`, html });
    if (!result.sent) return { success: false, error: `Envoi échoué (${result.reason})` };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sendBackInStockTest(toEmail: string): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const target = toEmail?.trim();
    if (!target) return { success: false, error: "Email destinataire requis." };
    const baseUrl = await getTenantBaseUrl(tenant.id);
    const unsubToken = encodeUnsubscribeToken(tenant.id, target, "STOCK_ALERTS");
    const { subject, html } = renderBackInStockDigestEmail({
      customerFirstName: "Marie",
      products: [
        {
          productName: "Bague solitaire zircon acier",
          reference: "BAG-9821",
          priceLabel: "4,20 €",
          productUrl: `${baseUrl}/fr/produits/exemple-1`,
          imageUrl: null,
        },
        {
          productName: "Collier chaîne fine dorée",
          reference: "COL-1187",
          priceLabel: "3,00 €",
          productUrl: `${baseUrl}/fr/produits/exemple-2`,
          imageUrl: null,
        },
        {
          productName: "Boucles créoles nacre",
          reference: "BO-3042",
          priceLabel: "3,00 €",
          productUrl: `${baseUrl}/fr/produits/exemple-3`,
          imageUrl: null,
        },
      ],
      browseAllUrl: `${baseUrl}/fr/produits`,
      unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
      companyLegal: tenant.name,
    });
    const result = await sendMail({ to: target, subject: `[TEST] ${subject}`, html });
    if (!result.sent) return { success: false, error: `Envoi échoué (${result.reason})` };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sendInactiveClientTest(toEmail: string): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const target = toEmail?.trim();
    if (!target) return { success: false, error: "Email destinataire requis." };
    const baseUrl = await getTenantBaseUrl(tenant.id);
    const unsubToken = encodeUnsubscribeToken(tenant.id, target, "INACTIVE_REMINDERS");
    const { subject, html } = renderInactiveClientEmail({
      customerFirstName: "Marie",
      shopName: tenant.name,
      daysSinceLastLogin: 42,
      catalogUrl: `${baseUrl}/fr/produits`,
      unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
      companyLegal: tenant.name,
    });
    const result = await sendMail({ to: target, subject: `[TEST] ${subject}`, html });
    if (!result.sent) return { success: false, error: `Envoi échoué (${result.reason})` };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sendWelcomeTest(toEmail: string): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const target = toEmail?.trim();
    if (!target) return { success: false, error: "Email destinataire requis." };
    const baseUrl = await getTenantBaseUrl(tenant.id);
    const unsubToken = encodeUnsubscribeToken(tenant.id, target, "MARKETING_ALL");
    const { subject, html } = renderWelcomeEmail({
      customerFirstName: "Marie",
      shopName: tenant.name,
      catalogUrl: `${baseUrl}/fr/produits`,
      contactEmail: `contact@${new URL(baseUrl).hostname}`,
      unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
      companyLegal: tenant.name,
    });
    const result = await sendMail({ to: target, subject: `[TEST] ${subject}`, html });
    if (!result.sent) return { success: false, error: `Envoi échoué (${result.reason})` };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Newsletter (envoi manuel)
// ─────────────────────────────────────────────────────────────

export async function sendNewsletterTestAction(
  toEmail: string,
  campaign: NewsletterCampaign,
): Promise<ActionResult> {
  try {
    const { tenant } = await requireAdmin();
    const target = toEmail?.trim();
    if (!target) return { success: false, error: "Email destinataire requis." };
    const res = await sendNewsletterTest(tenant.id, target, campaign);
    if (!res.success) return { success: false, error: res.error ?? "Envoi échoué" };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function launchNewsletterCampaign(campaign: NewsletterCampaign): Promise<
  ActionResult & { targeted?: number; sent?: number; skipped?: number; errors?: number; campaignId?: string }
> {
  try {
    const { tenant } = await requireAdmin();
    const scenario = await getOrCreateScenario(tenant.id, "NEWSLETTER");
    if (!scenario.enabled) {
      return {
        success: false,
        error: "Le scénario Newsletter est désactivé. Activez-le d'abord.",
      };
    }
    const res = await sendNewsletterCampaign(tenant.id, campaign);
    revalidatePath("/admin/emails");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[EmailScenarios] launchNewsletterCampaign", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Recherche produits pour la newsletter (autocomplete).
 */
export async function searchProductsForNewsletter(
  query: string,
  limit = 15,
): Promise<
  { id: string; name: string; reference: string; priceLabel: string; thumbUrl: string | null }[]
> {
  const { tenant } = await requireAdmin();
  const q = query.trim();
  const { prisma } = await import("@/lib/prisma");
  const products = await prisma.product.findMany({
    where: {
      tenantId: tenant.id,
      status: "ONLINE",
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { reference: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        orderBy: { isPrimary: "desc" },
        take: 1,
        select: {
          unitPrice: true,
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
      },
    },
  });
  return products.map((p) => {
    const v = p.colors[0];
    const priceNum = v ? Number(v.unitPrice) : 0;
    return {
      id: p.id,
      name: p.name,
      reference: p.reference,
      priceLabel: priceNum.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
      thumbUrl: v?.images[0]?.path ?? null,
    };
  });
}
