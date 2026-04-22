import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 secondes
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_LENGTH;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_CODE_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Indique combien de millisecondes il reste avant de pouvoir renvoyer un code.
 * Retourne 0 si on peut émettre maintenant.
 */
export async function getResendCooldownRemaining(email: string): Promise<number> {
  const normalizedEmail = normalizeEmail(email);
  const latest = await prisma.loginOtp.findFirst({
    where: { email: normalizedEmail },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!latest) return 0;
  const elapsed = Date.now() - latest.createdAt.getTime();
  return Math.max(0, OTP_RESEND_COOLDOWN_MS - elapsed);
}

/**
 * Crée un nouveau code OTP en base et retourne le code en clair.
 * Invalide les codes précédents non utilisés.
 */
export async function createLoginOtp(email: string): Promise<string> {
  const normalizedEmail = normalizeEmail(email);

  await prisma.loginOtp.updateMany({
    where: { email: normalizedEmail, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.loginOtp.create({
    data: {
      email: normalizedEmail,
      codeHash,
      expiresAt,
    },
  });

  return code;
}

export type VerifyLoginOtpResult =
  | { success: true }
  | {
      success: false;
      reason: "not_found" | "expired" | "too_many_attempts" | "invalid_code";
    };

/**
 * Vérifie un code OTP. En cas de succès, marque le code comme utilisé.
 * En cas d'échec, incrémente le compteur d'essais.
 */
export async function verifyLoginOtp(
  email: string,
  code: string
): Promise<VerifyLoginOtpResult> {
  const normalizedEmail = normalizeEmail(email);

  const otp = await prisma.loginOtp.findFirst({
    where: { email: normalizedEmail, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return { success: false, reason: "not_found" };

  if (otp.expiresAt.getTime() < Date.now()) {
    return { success: false, reason: "expired" };
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.loginOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });
    return { success: false, reason: "too_many_attempts" };
  }

  const expectedHash = hashOtpCode(code.trim());
  const providedBuf = Buffer.from(expectedHash, "hex");
  const storedBuf = Buffer.from(otp.codeHash, "hex");
  const sameLength = providedBuf.length === storedBuf.length;
  const matches =
    sameLength && crypto.timingSafeEqual(providedBuf, storedBuf);

  if (!matches) {
    const newAttempts = otp.attempts + 1;
    await prisma.loginOtp.update({
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

  await prisma.loginOtp.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });
  return { success: true };
}

/**
 * Envoie un email contenant le code OTP.
 * Ne jette pas si la config Resend est absente — log simplement un avertissement.
 */
export async function sendLoginOtpEmail(
  email: string,
  code: string
): Promise<void> {
  const shopName = await getCachedShopName();

  const result = await sendMail({
    fromName: shopName,
    to: email,
    subject: `Votre code de connexion — ${shopName}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
        <h2 style="color:#1A1A1A;margin-bottom:8px">Votre code de connexion</h2>
        <p style="color:#6B6B6B;margin-bottom:24px">Utilisez le code ci-dessous pour vous connecter à votre espace professionnel. Ce code est valable <strong>10 minutes</strong>.</p>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;background:#F5F5F5;color:#1A1A1A;padding:20px;border-radius:12px;text-align:center;margin:16px 0">${code}</div>
        <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Votre compte reste sécurisé.</p>
      </div>
    `,
  });

  if (!result.sent && result.reason === "no_config") {
    logger.warn("[login-otp] Configuration Resend manquante");
  }
}
