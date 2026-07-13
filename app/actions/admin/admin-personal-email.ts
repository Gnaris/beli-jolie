"use server";

import crypto from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import { logger } from "@/lib/logger";

/**
 * Vérification et verrouillage du mail perso de l'admin.
 *
 * Le mail perso est saisi APRÈS la création de la boîte pro. On envoie un
 * code à 6 chiffres sur ce mail perso via la boîte pro (`sendMail`). Une
 * fois validé, il est verrouillé — plus modifiable dans le wizard. Un
 * changement ultérieur passera par le panneau « Paramètres → Messagerie »
 * avec un nouveau code envoyé sur l'ancien mail perso.
 *
 * Clés SiteConfig (scopées tenant par l'extension Prisma) :
 *   - admin_personal_email                : mail vérifié (final)
 *   - admin_personal_email_verified_at    : timestamp verrouillage (ms)
 *   - admin_personal_email_pending        : mail en cours de vérification
 *   - admin_personal_email_otp_hash       : sha256 du code
 *   - admin_personal_email_otp_expires    : timestamp expiration (ms)
 *   - admin_personal_email_otp_attempts   : compteur tentatives
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PERSONAL_EMAIL_OTP_TTL_MS = 15 * 60 * 1000;
export const PERSONAL_EMAIL_OTP_MAX_ATTEMPTS = 5;
export const PERSONAL_EMAIL_OTP_LENGTH = 6;

export const KEY_VERIFIED_EMAIL = "admin_personal_email";
export const KEY_VERIFIED_AT = "admin_personal_email_verified_at";
export const KEY_PENDING_EMAIL = "admin_personal_email_pending";
export const KEY_OTP_HASH = "admin_personal_email_otp_hash";
export const KEY_OTP_EXPIRES = "admin_personal_email_otp_expires";
export const KEY_OTP_ATTEMPTS = "admin_personal_email_otp_attempts";

function generateCode(): string {
  const max = 10 ** PERSONAL_EMAIL_OTP_LENGTH;
  return crypto
    .randomInt(0, max)
    .toString()
    .padStart(PERSONAL_EMAIL_OTP_LENGTH, "0");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export type AdminPersonalEmailState = {
  /** Mail perso confirmé et verrouillé, s'il existe. */
  verifiedEmail: string | null;
  /** Timestamp ms du verrouillage, s'il existe. */
  verifiedAt: number | null;
  /** Mail perso en cours de vérification, s'il existe. */
  pendingEmail: string | null;
  /** Timestamp ms d'expiration du code en cours, s'il existe. */
  otpExpiresAt: number | null;
  /** Nombre de tentatives déjà consommées sur le code en cours. */
  otpAttempts: number;
};

export async function getAdminPersonalEmailState(): Promise<AdminPersonalEmailState> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId: tenant.id,
      key: {
        in: [
          KEY_VERIFIED_EMAIL,
          KEY_VERIFIED_AT,
          KEY_PENDING_EMAIL,
          KEY_OTP_EXPIRES,
          KEY_OTP_ATTEMPTS,
        ],
      },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  const verifiedAt = Number(map.get(KEY_VERIFIED_AT));
  const otpExpires = Number(map.get(KEY_OTP_EXPIRES));
  const attempts = Number(map.get(KEY_OTP_ATTEMPTS));
  return {
    verifiedEmail: (map.get(KEY_VERIFIED_EMAIL) || "").trim() || null,
    verifiedAt: Number.isFinite(verifiedAt) && verifiedAt > 0 ? verifiedAt : null,
    pendingEmail: (map.get(KEY_PENDING_EMAIL) || "").trim() || null,
    otpExpiresAt:
      Number.isFinite(otpExpires) && otpExpires > 0 ? otpExpires : null,
    otpAttempts: Number.isFinite(attempts) && attempts >= 0 ? attempts : 0,
  };
}

export type SendPersonalEmailOtpResult =
  | { success: true; email: string; expiresAt: number }
  | {
      success: false;
      error: string;
      code:
        | "invalid_email"
        | "already_verified"
        | "smtp_not_ready"
        | "send_failed";
    };

/**
 * Envoie (ou renvoie) un OTP au mail perso saisi. Efface toute vérification
 * en cours pour cet admin. Refuse si le mail perso est déjà verrouillé
 * (verifié) — dans ce cas il faut passer par la procédure de changement
 * depuis les paramètres.
 */
export async function sendAdminPersonalEmailOtp(
  emailRaw: string
): Promise<SendPersonalEmailOtpResult> {
  await requireAdmin();
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return { success: false, error: "Adresse invalide.", code: "invalid_email" };
  }

  const state = await getAdminPersonalEmailState();
  if (state.verifiedEmail) {
    return {
      success: false,
      error:
        "Un mail perso est déjà vérifié. Utilisez les Paramètres → Messagerie pour le changer.",
      code: "already_verified",
    };
  }

  const shopName = await getCachedShopName();
  const code = generateCode();
  const expiresAt = Date.now() + PERSONAL_EMAIL_OTP_TTL_MS;

  const mail = await sendMail({
    fromName: shopName,
    to: email,
    subject: `Code de vérification — ${shopName}`,
    html: buildPersonalEmailOtpHtml({ code, shopName, email }),
  });

  if (!mail.sent) {
    logger.warn("[admin-personal-email] Échec envoi OTP", {
      to: email,
      reason: mail.reason,
      error: "error" in mail ? mail.error : undefined,
    });
    if (mail.reason === "no_config" || mail.reason === "no_from") {
      return {
        success: false,
        error:
          "La boîte pro n'est pas encore branchée — créez-la avant de saisir votre mail perso.",
        code: "smtp_not_ready",
      };
    }
    return {
      success: false,
      error:
        "Impossible d'envoyer le code. Vérifiez l'adresse et réessayez.",
      code: "send_failed",
    };
  }

  await setSiteConfig(KEY_PENDING_EMAIL, email);
  await setSiteConfig(KEY_OTP_HASH, hashCode(code));
  await setSiteConfig(KEY_OTP_EXPIRES, String(expiresAt));
  await setSiteConfig(KEY_OTP_ATTEMPTS, "0");

  revalidateTag("site-config", "default");
  revalidatePath("/admin/bienvenue/email");

  return { success: true, email, expiresAt };
}

export type VerifyPersonalEmailOtpResult =
  | { success: true; email: string }
  | {
      success: false;
      error: string;
      code:
        | "no_pending"
        | "expired"
        | "too_many_attempts"
        | "invalid_code";
      attemptsRemaining?: number;
    };

/**
 * Vérifie le code saisi contre le hash stocké. Si OK : verrouille le mail
 * perso et efface l'OTP. Si KO : incrémente le compteur (bloqué après 5).
 */
export async function verifyAdminPersonalEmailOtp(
  codeRaw: string
): Promise<VerifyPersonalEmailOtpResult> {
  await requireAdmin();
  const code = (codeRaw ?? "").trim();

  const state = await getAdminPersonalEmailState();
  if (!state.pendingEmail || !state.otpExpiresAt) {
    return {
      success: false,
      error: "Aucun code en attente — renvoyez un nouveau code.",
      code: "no_pending",
    };
  }
  if (state.otpExpiresAt < Date.now()) {
    return {
      success: false,
      error: "Code expiré — renvoyez un nouveau code.",
      code: "expired",
    };
  }
  if (state.otpAttempts >= PERSONAL_EMAIL_OTP_MAX_ATTEMPTS) {
    return {
      success: false,
      error: "Trop de tentatives — renvoyez un nouveau code.",
      code: "too_many_attempts",
    };
  }

  // Timing-safe comparison.
  const hashRow = await prisma.siteConfig.findFirst({
    where: { key: KEY_OTP_HASH },
    select: { value: true },
  });
  const storedHash = (hashRow?.value ?? "").trim();
  const providedHash = hashCode(code);
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(providedHash, "hex");
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!same) {
    const newAttempts = state.otpAttempts + 1;
    await setSiteConfig(KEY_OTP_ATTEMPTS, String(newAttempts));
    const remaining = Math.max(
      0,
      PERSONAL_EMAIL_OTP_MAX_ATTEMPTS - newAttempts
    );
    if (remaining === 0) {
      return {
        success: false,
        error: "Trop de tentatives — renvoyez un nouveau code.",
        code: "too_many_attempts",
      };
    }
    return {
      success: false,
      error: `Code incorrect — ${remaining} tentative${remaining > 1 ? "s" : ""} restante${remaining > 1 ? "s" : ""}.`,
      code: "invalid_code",
      attemptsRemaining: remaining,
    };
  }

  // Succès : verrouille et efface l'OTP.
  await setSiteConfig(KEY_VERIFIED_EMAIL, state.pendingEmail);
  await setSiteConfig(KEY_VERIFIED_AT, String(Date.now()));
  await unsetSiteConfig(KEY_PENDING_EMAIL);
  await unsetSiteConfig(KEY_OTP_HASH);
  await unsetSiteConfig(KEY_OTP_EXPIRES);
  await unsetSiteConfig(KEY_OTP_ATTEMPTS);

  revalidateTag("site-config", "default");
  revalidatePath("/admin/bienvenue/email");
  revalidatePath("/admin/parametres");

  logger.info("[admin-personal-email] Mail perso verrouillé", {
    email: state.pendingEmail,
  });

  return { success: true, email: state.pendingEmail };
}

/**
 * Efface la vérification en cours (mail en attente + hash + expiration +
 * tentatives). Utilisé quand la cliente réalise qu'elle a saisi la mauvaise
 * adresse et veut recommencer. **Ne touche pas** au mail perso déjà
 * verrouillé.
 */
export async function resetPendingAdminPersonalEmail(): Promise<{
  success: true;
}> {
  await requireAdmin();
  await unsetSiteConfig(KEY_PENDING_EMAIL);
  await unsetSiteConfig(KEY_OTP_HASH);
  await unsetSiteConfig(KEY_OTP_EXPIRES);
  await unsetSiteConfig(KEY_OTP_ATTEMPTS);
  revalidateTag("site-config", "default");
  revalidatePath("/admin/bienvenue/email");
  return { success: true };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPersonalEmailOtpHtml(p: {
  code: string;
  shopName: string;
  email: string;
}): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
      <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="background:#F1F5F9;padding:20px 24px;border-bottom:1px solid #E2E8F0">
          <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${escapeHtml(p.shopName)} · Sécurité</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">
            Vérification de votre e-mail personnel
          </div>
        </div>
        <div style="padding:28px 24px">
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 12px">Bonjour,</p>
          <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 20px">
            Vous êtes en train d'enregistrer <strong>${escapeHtml(p.email)}</strong> comme
            e-mail personnel de récupération pour votre boutique <strong>${escapeHtml(p.shopName)}</strong>.
            C'est cette adresse qui recevra les codes de sécurité, les notifications privées
            et les liens de récupération de mot de passe de votre boîte pro.
          </p>
          <div style="margin:16px 0 20px;padding:28px 20px;border-radius:16px;background:#EEF2FF;border:2px solid #C7D2FE;text-align:center">
            <div style="font-size:11px;color:#4338CA;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Votre code</div>
            <div style="font-family:'Courier New',ui-monospace,monospace;font-size:36px;font-weight:700;color:#4338CA;letter-spacing:10px">${escapeHtml(p.code)}</div>
            <div style="font-size:11px;color:#4338CA;margin-top:12px;opacity:0.75">Expire dans 15 minutes</div>
          </div>
          <div style="background:#FFFBEB;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;margin:20px 0">
            <div style="font-size:12px;color:#78350F;line-height:1.5">
              <strong>⚠️ Vous n'avez pas demandé ce code ?</strong><br />
              Ignorez ce mail — sans le code, votre adresse ne sera pas enregistrée.
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
