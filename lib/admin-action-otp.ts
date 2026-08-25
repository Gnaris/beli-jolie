/**
 * lib/admin-action-otp.ts
 *
 * Vérification par code OTP (6 chiffres, envoyé par email à l'adresse pro)
 * avant toute action destructive sur des produits :
 *   - suppression
 *   - rafraîchissement (archive l'ancienne fiche PFS et republie)
 *   - archivage
 *
 * Filet de sécurité : si un bug côté site déclenche une de ces actions
 * en masse, la propagation vers les marketplaces (PFS/Ankor/eFashion/Faire)
 * reste bloquée tant que l'admin n'a pas saisi le code reçu par mail.
 *
 * Une "pause" (15min / 1h / 24h) peut être posée par l'admin depuis la
 * modale de confirmation : durant la pause, la vérification est court-
 * circuitée pour toutes les actions du même tenant.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getCachedShopName } from "@/lib/cached-data";
import { decryptIfSensitive } from "@/lib/encryption";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";

export type AdminActionKind = "delete" | "refresh" | "archive";
export type PauseChoice = "15min" | "1h" | "24h" | null;

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_MAX_ATTEMPTS = 5;

const PAUSE_KEY = "admin_action_otp_pause_until";

export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_LENGTH;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_CODE_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function actionLabelFR(action: AdminActionKind, count: number): string {
  const plural = count > 1 ? "s" : "";
  switch (action) {
    case "delete":
      return `Suppression de ${count} produit${plural}`;
    case "refresh":
      return `Rafraîchissement de ${count} produit${plural}`;
    case "archive":
      return `Archivage de ${count} produit${plural}`;
  }
}

/**
 * Adresse mail où recevoir le code. Priorité :
 * 1. admin_personal_email (mail perso vérifié via OTP au wizard — le plus sûr,
 *    ne peut pas être compromis via prise de contrôle de la boîte pro)
 * 2. smtp_from_email (adresse pro contact@boutique.com, forwardée sur mail perso)
 * 3. mailbox_forward_to (mail perso saisi au wizard, tant que la boîte pro n'existe pas)
 */
async function resolveOtpRecipient(tenantId: string): Promise<string | null> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId,
      key: {
        in: [
          "admin_personal_email",
          "admin_personal_email_verified_at",
          "smtp_from_email",
          "mailbox_forward_to",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const personal = (map.get("admin_personal_email") || "").trim();
  const personalVerified = Number(map.get("admin_personal_email_verified_at"));
  if (personal && Number.isFinite(personalVerified) && personalVerified > 0) {
    return personal;
  }
  const smtpFrom = decryptIfSensitive(
    "smtp_from_email",
    map.get("smtp_from_email") || ""
  ).trim();
  if (smtpFrom) return smtpFrom;
  const forwardTo = (map.get("mailbox_forward_to") || "").trim();
  if (forwardTo) return forwardTo;
  return null;
}

/** Vrai si l'admin a activé une pause qui court encore. */
export async function isOtpPauseActive(tenantId: string): Promise<boolean> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: PAUSE_KEY },
    select: { value: true },
  });
  if (!row?.value) return false;
  const ts = Number(row.value);
  if (!Number.isFinite(ts)) return false;
  return ts > Date.now();
}

/** Applique la pause choisie par l'admin. `null` = pas de pause (efface). */
export async function applyPauseChoice(
  tenantId: string,
  pause: PauseChoice
): Promise<void> {
  if (pause == null) {
    await unsetSiteConfig(PAUSE_KEY, { tenantId });
    return;
  }
  const now = Date.now();
  const durationMs =
    pause === "15min"
      ? 15 * 60 * 1000
      : pause === "1h"
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  await setSiteConfig(PAUSE_KEY, String(now + durationMs), { tenantId });
}

/**
 * Masque un email pour l'affichage retour côté UI (jamais renvoyer l'email en clair).
 * "contact@beliandjolie.com" → "con••••••@beliandjolie.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const kept = local.slice(0, Math.min(3, local.length));
  return `${kept}${"•".repeat(Math.max(1, local.length - 3))}@${domain}`;
}

interface CreateOtpParams {
  action: AdminActionKind;
  productIds: string[];
  productLabels: Array<{ reference: string; name?: string }>;
  adminId: string;
  tenantId: string;
}

export type CreateOtpResult =
  | { success: true; otpId: string; recipientMasked: string; expiresAt: number }
  | { success: false; reason: "no_recipient" | "send_failed" };

/**
 * Génère un code, l'envoie par mail, stocke le hash. Invalide les codes
 * précédents non consommés du même admin+action pour éviter les collisions.
 */
export async function createOtpForAction(
  params: CreateOtpParams
): Promise<CreateOtpResult> {
  const recipient = await resolveOtpRecipient(params.tenantId);
  if (!recipient) return { success: false, reason: "no_recipient" };

  await prisma.adminActionOtp.updateMany({
    where: {
      adminId: params.adminId,
      tenantId: params.tenantId,
      action: params.action,
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const otp = await prisma.adminActionOtp.create({
    data: {
      adminId: params.adminId,
      tenantId: params.tenantId,
      action: params.action,
      productIds: params.productIds,
      codeHash,
      expiresAt,
    },
  });

  const shopName = await getCachedShopName();
  const subject = `Code de confirmation — ${actionLabelFR(
    params.action,
    params.productIds.length
  )}`;

  const refList = params.productLabels
    .slice(0, 200)
    .map((l) => escapeHtml(l.reference))
    .join(" · ");

  const mail = await sendMail({
    fromName: shopName,
    to: recipient,
    subject,
    html: buildOtpEmailHtml({
      action: params.action,
      code,
      count: params.productIds.length,
      shopName,
      refList,
    }),
  });

  if (!mail.sent) {
    logger.warn("[admin-action-otp] Échec envoi mail OTP", {
      to: recipient,
      reason: mail.reason,
      error: "error" in mail ? mail.error : undefined,
    });
    return { success: false, reason: "send_failed" };
  }

  logger.info("[admin-action-otp] OTP créé et envoyé", {
    otpId: otp.id,
    action: params.action,
    count: params.productIds.length,
    to: maskEmail(recipient),
  });

  return {
    success: true,
    otpId: otp.id,
    recipientMasked: maskEmail(recipient),
    expiresAt: expiresAt.getTime(),
  };
}

/**
 * Erreur métier levée par `guardAdminActionOtp` quand la vérification
 * échoue. Le code (`ADMIN_OTP_*`) permet à l'UI de discriminer facilement.
 */
export class AdminActionOtpError extends Error {
  constructor(public readonly code: AdminActionOtpErrorCode) {
    super(code);
    this.name = "AdminActionOtpError";
  }
}

export type AdminActionOtpErrorCode =
  | "ADMIN_OTP_REQUIRED"
  | "ADMIN_OTP_NOT_FOUND"
  | "ADMIN_OTP_EXPIRED"
  | "ADMIN_OTP_INVALID_CODE"
  | "ADMIN_OTP_TOO_MANY_ATTEMPTS"
  | "ADMIN_OTP_WRONG_SCOPE";

function toErrorCode(reason: VerifyOtpFailReason): AdminActionOtpErrorCode {
  switch (reason) {
    case "not_found":
      return "ADMIN_OTP_NOT_FOUND";
    case "expired":
      return "ADMIN_OTP_EXPIRED";
    case "invalid_code":
      return "ADMIN_OTP_INVALID_CODE";
    case "too_many_attempts":
      return "ADMIN_OTP_TOO_MANY_ATTEMPTS";
    case "wrong_scope":
      return "ADMIN_OTP_WRONG_SCOPE";
  }
}

/**
 * Garde qu'on appelle EN DÉBUT de toute server action destructive.
 * - Si une pause est active pour le tenant → bypass silencieux.
 * - Sinon, exige un OTP valide correspondant à l'action + la liste des
 *   productIds. Consomme l'OTP (usage unique).
 * Lève `AdminActionOtpError` sinon.
 */
export async function guardAdminActionOtp(params: {
  action: AdminActionKind;
  productIds: string[];
  adminId: string;
  tenantId: string;
  otp?: { otpId: string; code: string } | null;
}): Promise<void> {
  // Bypass local (dev/test) pour l'action "delete" — facilite les tests de
  // suppression sans devoir attendre un code par mail. Prod (NODE_ENV=production)
  // reste protégée.
  if (
    process.env.NODE_ENV !== "production" &&
    params.action === "delete"
  ) {
    return;
  }

  const pauseActive = await isOtpPauseActive(params.tenantId);
  if (pauseActive) return;

  if (!params.otp) {
    throw new AdminActionOtpError("ADMIN_OTP_REQUIRED");
  }

  const result = await verifyAndConsumeOtp({
    otpId: params.otp.otpId,
    code: params.otp.code,
    action: params.action,
    adminId: params.adminId,
    tenantId: params.tenantId,
    productIds: params.productIds,
  });

  if (!result.success) {
    throw new AdminActionOtpError(toErrorCode(result.reason));
  }
}

export type VerifyOtpFailReason =
  | "not_found"
  | "expired"
  | "invalid_code"
  | "too_many_attempts"
  | "wrong_scope";

export type VerifyOtpResult =
  | { success: true }
  | { success: false; reason: VerifyOtpFailReason };

/**
 * Vérifie l'OTP en constant time et le marque comme utilisé si valide.
 * Fait une double vérification : action ET liste des productIds doivent
 * correspondre à ce qui a été demandé (protection anti-replay avec un
 * autre lot).
 */
export async function verifyAndConsumeOtp(params: {
  otpId: string;
  code: string;
  action: AdminActionKind;
  adminId: string;
  tenantId: string;
  productIds: string[];
}): Promise<VerifyOtpResult> {
  const otp = await prisma.adminActionOtp.findFirst({
    where: {
      id: params.otpId,
      adminId: params.adminId,
      tenantId: params.tenantId,
    },
  });
  if (!otp) return { success: false, reason: "not_found" };
  if (otp.usedAt) return { success: false, reason: "not_found" };
  if (otp.action !== params.action) {
    return { success: false, reason: "wrong_scope" };
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    return { success: false, reason: "expired" };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.adminActionOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });
    return { success: false, reason: "too_many_attempts" };
  }

  const storedIds = Array.isArray(otp.productIds)
    ? (otp.productIds as string[])
    : [];
  const sameSet =
    storedIds.length === params.productIds.length &&
    storedIds.every((id) => params.productIds.includes(id));
  if (!sameSet) return { success: false, reason: "wrong_scope" };

  const expectedHash = hashOtpCode(params.code.trim());
  const providedBuf = Buffer.from(expectedHash, "hex");
  const storedBuf = Buffer.from(otp.codeHash, "hex");
  const sameLength = providedBuf.length === storedBuf.length;
  const matches =
    sameLength && crypto.timingSafeEqual(providedBuf, storedBuf);

  if (!matches) {
    const newAttempts = otp.attempts + 1;
    await prisma.adminActionOtp.update({
      where: { id: otp.id },
      data: {
        attempts: newAttempts,
        usedAt: newAttempts >= OTP_MAX_ATTEMPTS ? new Date() : null,
      },
    });
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      return { success: false, reason: "too_many_attempts" };
    }
    return { success: false, reason: "invalid_code" };
  }

  await prisma.adminActionOtp.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });
  return { success: true };
}

// ─────────────────────────────────────────────
// Template email HTML
// ─────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildOtpEmailHtml(p: {
  action: AdminActionKind;
  code: string;
  count: number;
  shopName: string;
  refList: string;
}): string {
  const cfg = {
    delete: {
      color: "#F43F5E",
      bgLight: "#FFF1F2",
      borderLight: "#FECDD3",
      label: "Suppression",
      verbPast: "supprimée",
    },
    refresh: {
      color: "#0284C7",
      bgLight: "#F0F9FF",
      borderLight: "#BAE6FD",
      label: "Rafraîchissement",
      verbPast: "rafraîchie",
    },
    archive: {
      color: "#F59E0B",
      bgLight: "#FFFBEB",
      borderLight: "#FDE68A",
      label: "Archivage",
      verbPast: "archivée",
    },
  }[p.action];

  const plural = p.count > 1 ? "s" : "";
  const productWord = p.count > 1 ? `${p.count} produits` : `1 produit`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
      <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="background:#F1F5F9;padding:20px 24px;border-bottom:1px solid #E2E8F0">
          <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escapeHtml(
            p.shopName
          )} · Sécurité</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">
            Code de confirmation — ${cfg.label} de ${escapeHtml(productWord)}
          </div>
        </div>

        <div style="padding:28px 24px">
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 12px">Bonjour,</p>
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 20px">
            Une <strong>${cfg.label.toLowerCase()}</strong> de <strong>${escapeHtml(
    productWord
  )}</strong> vient d'être demandée depuis votre admin. Pour valider cette action, saisissez le code ci-dessous dans la fenêtre de confirmation.
          </p>

          <div style="margin:16px 0 20px;padding:28px 20px;border-radius:16px;background:${
            cfg.bgLight
          };border:2px solid ${cfg.borderLight};text-align:center">
            <div style="font-size:11px;color:${
              cfg.color
            };font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Votre code</div>
            <div style="font-family:'Courier New',ui-monospace,monospace;font-size:36px;font-weight:700;color:${
              cfg.color
            };letter-spacing:10px">${escapeHtml(p.code)}</div>
            <div style="font-size:11px;color:${
              cfg.color
            };margin-top:12px;opacity:0.75">Expire dans 15 minutes</div>
          </div>

          ${
            p.refList
              ? `
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 16px;margin:20px 0">
            <div style="font-size:10px;color:#64748B;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Produits concernés (${p.count})</div>
            <div style="font-family:ui-monospace,monospace;font-size:11px;color:#475569;line-height:1.7;word-break:break-all">${p.refList}</div>
          </div>
          `
              : ""
          }

          <div style="background:#FFFBEB;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;margin:20px 0">
            <div style="font-size:12px;color:#78350F;line-height:1.5">
              <strong>⚠️ Vous n'avez pas déclenché cette action ?</strong><br />
              Ignorez ce mail — sans le code, rien ne sera ${
                cfg.verbPast
              }${plural}. Prévenez-nous s'il s'agit d'une activité suspecte.
            </div>
          </div>

          <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">
            Code valable 15 minutes, à usage unique. Ne le partagez avec personne.
          </p>
        </div>
      </div>
      <p style="font-size:11px;color:#94A3B8;text-align:center;padding:12px 24px;margin:0">
        ${escapeHtml(p.shopName)} — Notification de sécurité automatique
      </p>
    </div>
  `;
}
