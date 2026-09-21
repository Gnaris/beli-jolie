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

    const result = await sendMail({
      fromName: shopName,
      to: personalEmail,
      subject: `⚠️ Bug paiement ${shopName} — ${whenShort} — ${clientLabel}`,
      html: buildPaymentErrorHtml({
        shopName,
        clientLabel,
        clientCompany,
        when,
        input,
        browser,
      }),
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

function buildPaymentErrorHtml(p: {
  shopName: string;
  clientLabel: string;
  clientCompany: string | null;
  when: string;
  browser: string;
  input: PaymentErrorNotifyInput;
}): string {
  const { input } = p;
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

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
      <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="background:#FEE2E2;padding:20px 24px;border-bottom:1px solid #FCA5A5">
          <div style="font-size:11px;color:#991B1B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escapeHtml(p.shopName)} · Bug paiement</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">⚠️ Un client n'a pas pu payer</div>
        </div>
        <div style="padding:28px 24px">
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px">
            Un client de <strong>${escapeHtml(p.shopName)}</strong> a rencontré un bug technique en essayant de payer.
          </p>
          <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;margin:8px 0 20px">
            <tr><td style="padding:6px 0;color:#64748B;width:170px">Client&nbsp;:</td><td style="padding:6px 0"><strong>${escapeHtml(p.clientLabel)}</strong></td></tr>
            ${p.clientCompany ? `<tr><td style="padding:6px 0;color:#64748B">Société&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.clientCompany)}</td></tr>` : ""}
            <tr><td style="padding:6px 0;color:#64748B">Date&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.when)} (heure de Paris)</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Étape&nbsp;:</td><td style="padding:6px 0">${escapeHtml(stageLabel)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Origine&nbsp;:</td><td style="padding:6px 0">${escapeHtml(sourceLabel)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">Montant&nbsp;:</td><td style="padding:6px 0">${escapeHtml(formatAmount(input.amountCents))}</td></tr>
            ${input.paymentIntentId ? `<tr><td style="padding:6px 0;color:#64748B">PaymentIntent&nbsp;:</td><td style="padding:6px 0"><code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(input.paymentIntentId)}</code></td></tr>` : ""}
            ${input.orderId ? `<tr><td style="padding:6px 0;color:#64748B">Commande&nbsp;:</td><td style="padding:6px 0"><code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px">${escapeHtml(input.orderId)}</code></td></tr>` : ""}
            <tr><td style="padding:6px 0;color:#64748B">Navigateur&nbsp;:</td><td style="padding:6px 0">${escapeHtml(p.browser)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B">IP&nbsp;:</td><td style="padding:6px 0">${escapeHtml(input.ip)}</td></tr>
          </table>
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin:16px 0">
            <div style="font-size:11px;color:#991B1B;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Erreur technique (côté Stripe)</div>
            <div style="font-size:13px;color:#450A0A;font-family:'Courier New',monospace;line-height:1.7">${errorLines}</div>
          </div>
          <p style="font-size:12px;color:#94A3B8;margin:20px 0 0;line-height:1.5">
            Cette alerte n'est envoyée qu'une fois par 5 minutes pour un même client et une même erreur — les tentatives répétées ne créent pas de spam.
          </p>
        </div>
      </div>
      <p style="text-align:center;font-size:11px;color:#94A3B8;margin:16px 0 0">
        Notification automatique — ne pas répondre à cet email.
      </p>
    </div>
  `.trim();
}
