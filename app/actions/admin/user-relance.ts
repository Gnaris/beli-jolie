"use server";

/**
 * Relance manuelle d'un client depuis /admin/utilisateurs.
 *
 * L'admin clique sur "…" sur une ligne, choisit "Relancer par mail" — la
 * server action détecte automatiquement le bon scénario selon l'état du user :
 *   - Panier ≥ 1 item et inactif > 24h → ABANDONED_CART (relance panier)
 *   - Sinon si lastLogin > 7j → INACTIVE_CLIENT (rappel doux)
 *   - Sinon → refus (rien à relancer)
 *
 * Rate limit strict : max 1 relance manuelle par (user, jour) — appliqué via
 * la contrainte unique EmailSend(tenantId, scenarioKey, dedupKey) avec
 * dedupKey = `manual:user-<id>:<YYYYMMDD>`.
 *
 * L'appelant DOIT être ADMIN — `requireAdmin()` en tête.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { runAbandonedCartScan } from "@/lib/email-marketing/abandoned-cart";
import { sendInactiveClientEmail } from "@/lib/email-marketing/inactive-client";
import { isUnsubscribed } from "@/lib/email-marketing/unsubscribe";
import { getTenantBaseUrl } from "@/lib/email-marketing/tenant-domain";
import { encodeUnsubscribeToken } from "@/lib/email-marketing/tokens";
import { renderInactiveClientEmail } from "@/lib/email-marketing/templates/inactive-client";
import {
  renderAbandonedCartEmail,
  type AbandonedCartItemView,
} from "@/lib/email-marketing/templates/abandoned-cart";

export type RelanceKind = "ABANDONED_CART" | "INACTIVE_CLIENT";

/** Un scénario proposé à l'admin dans la modale. */
export interface RelanceOption {
  kind: RelanceKind;
  /** Titre court affiché sur la carte (ex. "Rappel de panier abandonné"). */
  title: string;
  /** Résumé humain (ex. "Panier de 3 articles laissé depuis 2 jours"). */
  description: string;
  /** Sujet exact du mail qui partirait. */
  emailSubject: string;
  /** True si l'admin peut cliquer envoyer ce mail. */
  canSend: boolean;
  /** Si canSend = false, motif à afficher sous la carte (grisé). */
  blockReason?: string;
  cartItemCount?: number;
  daysSinceLastLogin?: number;
}

export interface RelanceEligibility {
  /** Tous les scénarios pertinents pour ce client, dans l'ordre d'affichage. */
  options: RelanceOption[];
  /** True si au moins un scénario est envoyable. */
  hasAnyAvailable: boolean;
  /** Motif global (rate limit, désabo total, jamais connecté). Vide sinon. */
  globalBlockReason?: string;
  /** Email de l'admin connecté, pré-rempli côté UI pour l'aperçu. */
  adminEmail: string;
}

const RATE_LIMIT_HOURS = 24;
const INACTIVE_THRESHOLD_DAYS = 7;
const ABANDONED_CART_MIN_HOURS = 24;

/**
 * Analyse l'état du user et renvoie le scénario applicable + un message
 * explicatif. Aucun envoi. Utilisé par la modale de confirmation pour dire
 * à l'admin ce qui va se passer AVANT de cliquer "Envoyer".
 */
// Sujets EXACTS des templates — miroir de ce que renvoient renderAbandonedCartEmail
// et renderInactiveClientEmail. Si tu changes un template, mets à jour ici pour
// que la modale affiche le vrai sujet.
const ABANDONED_CART_SUBJECT_STAGE_0 = "Vous avez laissé quelques articles derrière vous";

function buildInactiveSubject(shopName: string): string {
  return `Nouveautés et retours en stock chez ${shopName}`;
}

export async function checkRelanceEligibility(
  userId: string,
): Promise<{ success: true; data: RelanceEligibility } | { success: false; error: string }> {
  try {
    const { tenant, session } = await requireAdmin();
    const adminEmail = String(session.user.email ?? "");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        status: true,
        role: true,
        lastLoginAt: true,
        lastSeenAt: true,
        tenantId: true,
      },
    });
    if (!user || user.tenantId !== tenant.id) {
      return { success: false, error: "Client introuvable." };
    }
    if (user.role !== "CLIENT") {
      return { success: false, error: "Ce compte n'est pas un client." };
    }
    if (user.status !== "APPROVED") {
      return {
        success: false,
        error: "Le compte doit être approuvé avant de recevoir une relance.",
      };
    }
    const email = user.email?.trim();
    if (!email) {
      return { success: false, error: "Ce client n'a pas d'adresse email." };
    }

    const now = Date.now();

    // Rate limit global (24h max entre 2 relances manuelles pour ce client).
    // S'il est actif, on renvoie zéro option envoyable + un motif global.
    const rateLimitSince = new Date(now - RATE_LIMIT_HOURS * 60 * 60 * 1000);
    const lastManual = await prisma.emailSend.findFirst({
      where: {
        tenantId: tenant.id,
        userId,
        scenarioKey: "MANUAL_RELANCE",
        sentAt: { gte: rateLimitSince },
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    let globalBlockReason: string | undefined;
    if (lastManual) {
      const nextAllowedAt = new Date(
        lastManual.sentAt.getTime() + RATE_LIMIT_HOURS * 60 * 60 * 1000,
      );
      const msLeft = nextAllowedAt.getTime() - now;
      const nextAllowedLabel = nextAllowedAt.toLocaleString("fr-FR", {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      globalBlockReason = `Une relance a déjà été envoyée à ce client il y a ${formatDurationAgo(now - lastManual.sentAt.getTime())}. Vous pourrez le relancer dans ${formatDurationShort(msLeft)} (${nextAllowedLabel}).`;
    }

    // Désabonnement total : coupe tout.
    if (await isUnsubscribed(tenant.id, email, "MARKETING_ALL")) {
      return {
        success: true,
        data: {
          options: [],
          hasAnyAvailable: false,
          globalBlockReason:
            "Ce client s'est désabonné de tous les emails marketing — aucun envoi possible.",
          adminEmail,
        },
      };
    }

    const options: RelanceOption[] = [];

    // ═══ Option 1 : Panier abandonné ═══════════════════════════
    const cart = await prisma.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
    });
    const cartAgeHours = cart
      ? (now - cart.updatedAt.getTime()) / (60 * 60 * 1000)
      : 0;

    if (cart && cart._count.items > 0) {
      const items = cart._count.items;
      const itemsLabel = `${items} article${items > 1 ? "s" : ""}`;
      const ageLabel =
        cartAgeHours < 24
          ? `${Math.floor(cartAgeHours)}h`
          : `${Math.floor(cartAgeHours / 24)}j`;

      const unsubCart = await isUnsubscribed(tenant.id, email, "CART_REMINDERS");
      const tooFresh = cartAgeHours < ABANDONED_CART_MIN_HOURS;
      const rateBlocked = !!lastManual;

      let canSend = true;
      let blockReason: string | undefined;
      if (rateBlocked) {
        canSend = false;
        blockReason = globalBlockReason;
      } else if (unsubCart) {
        canSend = false;
        blockReason = "Client désabonné des rappels de panier.";
      } else if (tooFresh) {
        canSend = false;
        const wait = (ABANDONED_CART_MIN_HOURS - cartAgeHours) * 60 * 60 * 1000;
        blockReason = `Panier trop récent — patientez encore ${formatDurationShort(wait)} avant l'envoi.`;
      }

      options.push({
        kind: "ABANDONED_CART",
        title: "Rappel de panier abandonné",
        description: `Panier de ${itemsLabel} laissé depuis ${ageLabel}. L'email liste les articles avec photo, prix et bouton « Reprendre ma commande ».`,
        emailSubject: ABANDONED_CART_SUBJECT_STAGE_0,
        canSend,
        blockReason,
        cartItemCount: items,
      });
    }

    // ═══ Option 2 : Client inactif ═════════════════════════════
    const lastActivity = mostRecent(user.lastLoginAt, user.lastSeenAt);
    const daysSince = lastActivity
      ? Math.floor((now - lastActivity.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    if (daysSince !== null) {
      const unsubInactive = await isUnsubscribed(tenant.id, email, "INACTIVE_REMINDERS");
      const tooFresh = daysSince < INACTIVE_THRESHOLD_DAYS;
      const rateBlocked = !!lastManual;
      const daysLabel =
        daysSince === 0
          ? "moins d'un jour"
          : `${daysSince} jour${daysSince > 1 ? "s" : ""}`;

      let canSend = true;
      let blockReason: string | undefined;
      if (rateBlocked) {
        canSend = false;
        blockReason = globalBlockReason;
      } else if (unsubInactive) {
        canSend = false;
        blockReason = "Client désabonné des rappels d'inactivité.";
      } else if (tooFresh) {
        canSend = false;
        const daysLeft = INACTIVE_THRESHOLD_DAYS - daysSince;
        blockReason = `Client connecté il y a ${daysLabel} — attendez encore ${daysLeft} jour${daysLeft > 1 ? "s" : ""} (seuil ${INACTIVE_THRESHOLD_DAYS} jours).`;
      }

      options.push({
        kind: "INACTIVE_CLIENT",
        title: "Relance client inactif",
        description: `Client sans connexion depuis ${daysLabel}. L'email met en avant les nouveautés du catalogue et l'accès aux prix pros avec un ton commercial.`,
        emailSubject: buildInactiveSubject(tenant.name),
        canSend,
        blockReason,
        daysSinceLastLogin: daysSince,
      });
    }

    // Si aucun scénario n'est pertinent (pas de panier ET jamais connecté).
    if (options.length === 0) {
      return {
        success: true,
        data: {
          options: [],
          hasAnyAvailable: false,
          globalBlockReason:
            globalBlockReason ??
            "Aucun scénario n'est applicable : ce client n'a pas de panier et ne s'est jamais connecté.",
          adminEmail,
        },
      };
    }

    return {
      success: true,
      data: {
        options,
        hasAnyAvailable: options.some((o) => o.canSend),
        globalBlockReason,
        adminEmail,
      },
    };
  } catch (err) {
    logger.error("[UserRelance] checkRelanceEligibility", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Rend le mail EXACT qui partirait au client (avec ses vraies données : nom,
 * panier, jours d'inactivité) et l'envoie à une adresse de test — sans toucher
 * au client ni écrire de ligne EmailSend/rate-limit.
 *
 * Utilisé par le bouton "M'envoyer un aperçu" dans la modale.
 */
export async function sendManualRelancePreview(
  userId: string,
  kind: RelanceKind,
  toEmail: string,
): Promise<{ success: true; kind: RelanceKind; subject: string } | { success: false; error: string }> {
  try {
    const target = toEmail.trim();
    if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return { success: false, error: "Adresse email de test invalide." };
    }

    const eligibility = await checkRelanceEligibility(userId);
    if (!eligibility.success) return { success: false, error: eligibility.error };
    const option = eligibility.data.options.find((o) => o.kind === kind);
    if (!option) {
      return { success: false, error: "Ce scénario n'est pas applicable pour ce client." };
    }
    if (!option.canSend) {
      return { success: false, error: option.blockReason ?? "Envoi non autorisé." };
    }

    const { tenant } = await requireAdmin();
    const baseUrl = await getTenantBaseUrl(tenant.id);
    const companyLegal = await getCompanyLegalLine(tenant.id);

    if (kind === "INACTIVE_CLIENT") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });
      const unsubToken = encodeUnsubscribeToken(tenant.id, target, "INACTIVE_REMINDERS");
      const { subject, html } = renderInactiveClientEmail({
        customerFirstName: user?.firstName ?? "",
        shopName: tenant.name,
        daysSinceLastLogin: option.daysSinceLastLogin ?? 30,
        catalogUrl: `${baseUrl}/fr/produits`,
        unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
        companyLegal,
      });
      const res = await sendMail({ to: target, subject: `[APERÇU] ${subject}`, html });
      if (!res.sent) {
        return { success: false, error: formatSmtpError(res) };
      }
      return { success: true, kind: "INACTIVE_CLIENT", subject };
    }

    // kind === "ABANDONED_CART"
    const cart = await prisma.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        user: { select: { firstName: true } },
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                unitPrice: true,
                product: { select: { name: true, reference: true } },
                color: { select: { name: true } },
                images: {
                  orderBy: { order: "asc" },
                  take: 1,
                  select: { path: true },
                },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      return { success: false, error: "Panier introuvable ou vide." };
    }

    const items: AbandonedCartItemView[] = cart.items.map((line) => {
      const unit = Number(line.variant.unitPrice);
      const total = unit * line.quantity;
      const imagePath = line.variant.images[0]?.path;
      return {
        productName: line.variant.product.name,
        reference: line.variant.product.reference,
        colorName: line.variant.color?.name ?? null,
        quantity: line.quantity,
        linePriceLabel: total.toLocaleString("fr-FR", {
          style: "currency",
          currency: "EUR",
        }),
        imageUrl: imagePath ? absoluteUrl(baseUrl, imagePath) : null,
        fallbackInitial: (line.variant.product.name?.[0] ?? "•").toUpperCase(),
      };
    });
    const totalCents = cart.items.reduce(
      (sum, l) => sum + Math.round(Number(l.variant.unitPrice) * 100) * l.quantity,
      0,
    );
    const totalLabel = (totalCents / 100).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
    });
    const itemCount = cart.items.reduce((sum, l) => sum + l.quantity, 0);

    const unsubToken = encodeUnsubscribeToken(tenant.id, target, "CART_REMINDERS");
    const { subject, html } = renderAbandonedCartEmail({
      customerFirstName: cart.user?.firstName ?? "",
      items,
      totalLabel,
      itemCount,
      resumeUrl: `${baseUrl}/panier`,
      unsubscribeUrl: `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`,
      companyLegal,
      reminderIndex: 0,
    });
    const res = await sendMail({ to: target, subject: `[APERÇU] ${subject}`, html });
    if (!res.sent) {
      return { success: false, error: formatSmtpError(res) };
    }
    return { success: true, kind: "ABANDONED_CART", subject };
  } catch (err) {
    logger.error("[UserRelance] sendManualRelancePreview", { userId, kind, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

/** "2 h 15 min", "23 min", "3 j" — pour "vous pourrez relancer dans …". */
function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours} h ${minutes} min` : `${totalHours} h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} j ${hours} h` : `${days} j`;
}

/** "il y a 3 h 20 min" — pour un événement passé. */
function formatDurationAgo(ms: number): string {
  return formatDurationShort(ms);
}

function formatSmtpError(
  res: { sent: false; reason: "no_config" | "no_from" | "smtp_error"; error?: string },
): string {
  if (res.reason === "no_config") {
    return "Aucun serveur SMTP configuré pour cette boutique. Allez dans /admin/parametres → Emails pour renseigner l'hôte, le port, l'identifiant et le mot de passe SMTP.";
  }
  if (res.reason === "no_from") {
    return "Aucune adresse expéditrice configurée. Renseignez « Adresse d'envoi » dans /admin/parametres → Emails.";
  }
  return res.error
    ? `Serveur SMTP a refusé l'envoi : ${res.error}`
    : "Le serveur SMTP a refusé l'envoi (raison inconnue). Vérifiez les logs.";
}

function absoluteUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

async function getCompanyLegalLine(tenantId: string): Promise<string> {
  try {
    const info = await prisma.companyInfo.findFirst({
      where: { tenantId },
      select: { shopName: true, name: true, address: true, postalCode: true, city: true },
    });
    if (!info) return "";
    const displayName = info.shopName?.trim() || info.name?.trim();
    const addressLine = [
      info.address,
      [info.postalCode, info.city].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    return [displayName, addressLine].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}

/**
 * Envoie la relance manuelle. Refuse si non éligible (recheck côté serveur
 * pour éviter le bypass depuis l'UI).
 *
 * Traçabilité : la ligne EmailSend est créée avec scenarioKey = MANUAL_RELANCE
 * pour bien distinguer les envois manuels des envois automatiques, tout en
 * réutilisant le rendu du template (ABANDONED_CART ou INACTIVE_CLIENT).
 */
export async function sendManualRelance(
  userId: string,
  kind: RelanceKind,
): Promise<
  | { success: true; kind: RelanceKind; message: string }
  | { success: false; error: string }
> {
  try {
    const eligibility = await checkRelanceEligibility(userId);
    if (!eligibility.success) return { success: false, error: eligibility.error };
    const option = eligibility.data.options.find((o) => o.kind === kind);
    if (!option) {
      return { success: false, error: "Ce scénario n'est pas applicable pour ce client." };
    }
    if (!option.canSend) {
      return { success: false, error: option.blockReason ?? "Envoi non autorisé." };
    }

    const { tenant } = await requireAdmin();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastLoginAt: true, lastSeenAt: true },
    });
    if (!user?.email) return { success: false, error: "Email introuvable." };

    const stamp = ymd(new Date());
    const dedupKey = `manual:user-${userId}:${stamp}`;

    if (kind === "INACTIVE_CLIENT") {
      const days = option.daysSinceLastLogin ?? 30;
      const ok = await sendInactiveClientEmail({
        tenantId: tenant.id,
        userId,
        email: user.email,
        firstName: user.firstName ?? "",
        daysSinceLastLogin: days,
        dedupKey,
        scenarioKey: "MANUAL_RELANCE",
      });
      revalidatePath("/admin/utilisateurs");
      if (!ok) {
        return {
          success: false,
          error: "L'envoi SMTP a échoué. Cliquez « M'envoyer un aperçu » pour voir le motif exact (config manquante, port bloqué, etc.).",
        };
      }
      return {
        success: true,
        kind: "INACTIVE_CLIENT",
        message: `Rappel envoyé à ${user.email}`,
      };
    }

    if (kind === "ABANDONED_CART") {
      // On délègue au scan classique — il gère la logique complète (items,
      // prix, image, unsubscribe, dédup par (cart, stage)). L'admin peut
      // toujours re-cliquer plus tard : le rate-limit du dessus (24h manuel)
      // reste posé grâce au MANUAL_RELANCE marker qu'on écrit ci-dessous.
      const res = await runAbandonedCartScan(tenant.id);
      // Trace notre appel manuel (empêche double-clic ou re-tentative 24h).
      await prisma.emailSend.upsert({
        where: {
          tenantId_scenarioKey_dedupKey: {
            tenantId: tenant.id,
            scenarioKey: "MANUAL_RELANCE",
            dedupKey,
          },
        },
        create: {
          tenantId: tenant.id,
          scenarioKey: "MANUAL_RELANCE",
          recipientEmail: user.email.toLowerCase().trim(),
          userId,
          subject: `[Relance manuelle panier] ${res.sent} envoyé(s), ${res.skipped} ignoré(s)`,
          dedupKey,
          metadata: { source: "manual", trigger: "ABANDONED_CART", ...res },
        },
        update: {},
      });
      revalidatePath("/admin/utilisateurs");
      if (res.sent === 0) {
        return {
          success: false,
          error: "Rien envoyé — le panier a peut-être déjà été relancé automatiquement récemment.",
        };
      }
      return {
        success: true,
        kind: "ABANDONED_CART",
        message: `Relance panier envoyée (${res.sent} email${res.sent > 1 ? "s" : ""}).`,
      };
    }

    return { success: false, error: "Aucun scénario applicable." };
  } catch (err) {
    logger.error("[UserRelance] sendManualRelance", { userId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mostRecent(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
