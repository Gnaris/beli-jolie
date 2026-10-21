/**
 * Notifie l'admin (mail perso configuré en SiteConfig `admin_personal_email`)
 * quand un client rencontre un bug technique dans le tunnel Stripe.
 *
 * On distingue :
 *   - **Bug technique** (envoi mail) : le formulaire n'a pas pu s'ouvrir, une
 *     exception API Stripe, une méthode indisponible… bref, un truc qui n'est
 *     PAS la faute du client et qu'il faut investiguer.
 *   - **Erreur client attendue** (pas de mail) : carte refusée, CVC faux,
 *     3D-Secure abandonné, fonds insuffisants — c'est le comportement normal
 *     du parcours, on ne réveille pas la cliente pour ça.
 *
 * Anti-spam : cache mémoire 5 min par (tenant, user/IP, code d'erreur). Si le
 * même client réessaie 5 fois d'affilée avec la même erreur, un seul mail est
 * envoyé.
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import { logger } from "@/lib/logger";
import { parseUserAgent } from "@/lib/admin-login-notify";
import { renderTransactionalEmail } from "@/lib/transactional-email-render";

/** Payload identique à ce que la route telemetry log — reprend ces champs. */
export interface PaymentErrorNotifyInput {
  stage: "load" | "confirm";
  source: "checkout" | "pay-order-by-card";
  paymentIntentId: string | null;
  orderId: string | null;
  amountCents: number | null;
  offeredMethods: string[] | null;
  attemptedMethod: string | null;
  stripeError: {
    type?: string;
    code?: string;
    declineCode?: string;
    message?: string;
    paymentMethodType?: string;
  } | null;
  page: string | null;
  userId: string | null;
  userEmail: string | null;
  tenantId: string | null;
  ip: string;
  userAgent: string | null;
}

/**
 * Types Stripe considérés comme "utilisateur" — on ne notifie pas.
 * Cf. https://stripe.com/docs/api/errors — `card_error` = carte/banque du
 * client, `validation_error` = mauvaise saisie côté formulaire.
 */
const CLIENT_FAULT_TYPES = new Set(["card_error", "validation_error"]);

/**
 * Codes Stripe attendus dans un parcours normal (carte refusée, 3DS…). Même
 * s'ils remontent avec un `type` technique, ils ne justifient pas un mail.
 */
const CLIENT_FAULT_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "incorrect_zip",
  "invalid_cvc",
  "invalid_expiry_month",
  "invalid_expiry_year",
  "invalid_number",
  "insufficient_funds",
  "authentication_required",
  "payment_intent_authentication_failure",
]);

export function isTechnicalPaymentError(
  err: PaymentErrorNotifyInput["stripeError"] | null,
  stage: "load" | "confirm",
): boolean {
  // Un `onLoadError` est TOUJOURS technique — un client ne peut pas être
  // responsable d'un formulaire qui n'arrive pas à s'ouvrir.
  if (stage === "load") return true;
  if (!err) return true;
  if (err.type && CLIENT_FAULT_TYPES.has(err.type)) return false;
  if (err.code && CLIENT_FAULT_CODES.has(err.code)) return false;
  return true;
}

/** Cache dédup — clé = `${tenantId}:${userKey}:${errCode}`, valeur = expiresAt. */
const recentNotifications = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60_000;

function shouldDedupe(input: PaymentErrorNotifyInput): boolean {
  const userKey = input.userId ?? input.ip ?? "unknown";
  const errCode = input.stripeError?.code ?? input.stripeError?.type ?? "unknown";
  const key = `${input.tenantId ?? "no-tenant"}:${userKey}:${input.stage}:${errCode}`;
  const now = Date.now();
  const existing = recentNotifications.get(key);
  if (existing && existing > now) return true;
  recentNotifications.set(key, now + DEDUP_WINDOW_MS);
  // Nettoyage opportuniste (évite fuite mémoire long terme).
  if (recentNotifications.size > 500) {
    for (const [k, exp] of recentNotifications) {
      if (exp <= now) recentNotifications.delete(k);
    }
  }
  return false;
}

/** Reset du cache dédup — pour les tests uniquement. */
export function _resetPaymentErrorDedup(): void {
  recentNotifications.clear();
}

const KEY_PERSONAL_EMAIL = "admin_personal_email";

export async function notifyPaymentErrorIfTechnical(
  input: PaymentErrorNotifyInput,
): Promise<void> {
  try {
    if (!isTechnicalPaymentError(input.stripeError, input.stage)) return;
    if (shouldDedupe(input)) return;

    const row = await prisma.siteConfig.findFirst({
      where: { key: KEY_PERSONAL_EMAIL },
      select: { value: true },
    });
    const personalEmail = (row?.value ?? "").trim();
    if (!personalEmail) {
      logger.info("[payment-error-notify] skip: pas de mail perso configuré", {
        tenantId: input.tenantId,
      });
      return;
    }

    // Enrichit avec le nom du client depuis la BDD (l'email en base peut
    // porter plus d'infos que ce qui est dans la session).
    let clientLabel = input.userEmail ?? "Client anonyme";
    let clientCompany: string | null = null;
    if (input.userId) {
      const u = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { firstName: true, lastName: true, email: true, company: true },
      });
      if (u) {
        const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
        clientLabel = name ? `${name} (${u.email})` : u.email;
        clientCompany = u.company ?? null;
      }
    }

    const shopName = await getCachedShopName();
    const browser = parseUserAgent(input.userAgent);
    const when = new Date().toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "full",
      timeStyle: "short",
    });
    // Timestamp compact pour l'objet du mail — précis à la seconde, heure de
    // Paris. Format DD/MM/YYYY HH:MM:SS pour retrouver rapidement l'entrée de
    // log correspondante en cas d'investigation.
    const whenShort = new Date().toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const err = input.stripeError ?? {};
    const stageLabel = input.stage === "load"
      ? "Chargement du formulaire de paiement"
      : "Confirmation du paiement (clic sur « Payer »)";
    const sourceLabel = input.source === "checkout"
      ? "Tunnel de commande"
      : "Bouton « payer par carte » (commande virement)";
    const errorLines = [
      err.type && `Type : ${escapeHtml(err.type)}`,
      err.code && `Code : ${escapeHtml(err.code)}`,
      err.declineCode && `Decline code : ${escapeHtml(err.declineCode)}`,
      err.paymentMethodType && `Méthode : ${escapeHtml(err.paymentMethodType)}`,
      err.message && `Message : ${escapeHtml(err.message)}`,
    ].filter(Boolean).join("<br/>") || "Aucun détail Stripe.";

    const rendered = await renderTransactionalEmail({
      scenarioKey: "ADMIN_PAYMENT_ERROR",
      vars: {
        shopName: escapeHtml(shopName),
        clientLabel: escapeHtml(clientLabel),
        clientCompany: clientCompany ? escapeHtml(clientCompany) : "",
        when: escapeHtml(when),
        whenShort: escapeHtml(whenShort),
        stageLabel: escapeHtml(stageLabel),
        sourceLabel: escapeHtml(sourceLabel),
        amount: escapeHtml(formatAmount(input.amountCents)),
        paymentIntentId: input.paymentIntentId ? escapeHtml(input.paymentIntentId) : "—",
        orderId: input.orderId ? escapeHtml(input.orderId) : "—",
        browser: escapeHtml(browser),
        ip: escapeHtml(input.ip),
        errorLines,
      },
    });

    const result = await sendMail({
      fromName: shopName,
      to: personalEmail,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (!result.sent) {
      logger.warn("[payment-error-notify] échec envoi", {
        reason: result.reason,
        error: "error" in result ? result.error : undefined,
      });
    }
  } catch (error) {
    // Ne JAMAIS propager : la télémétrie doit toujours répondre 200 même si
    // le mail échoue (SMTP down, BDD lente…). Un log serveur suffit.
    logger.warn("[payment-error-notify] exception", { error });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatAmount(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2)} €`;
}

