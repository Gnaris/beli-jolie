// Constantes et types partagés pour le flow OTP mail perso admin.
// Ce fichier n'a PAS de "use server" : il peut donc exporter des `const`
// et des `type`, ce que les fichiers server-only (Next 16 / Turbopack)
// interdisent.

export const PERSONAL_EMAIL_OTP_TTL_MS = 15 * 60 * 1000;
export const PERSONAL_EMAIL_OTP_MAX_ATTEMPTS = 5;
export const PERSONAL_EMAIL_OTP_LENGTH = 6;

export const KEY_VERIFIED_EMAIL = "admin_personal_email";
export const KEY_VERIFIED_AT = "admin_personal_email_verified_at";
export const KEY_PENDING_EMAIL = "admin_personal_email_pending";
export const KEY_OTP_HASH = "admin_personal_email_otp_hash";
export const KEY_OTP_EXPIRES = "admin_personal_email_otp_expires";
export const KEY_OTP_ATTEMPTS = "admin_personal_email_otp_attempts";

export type AdminPersonalEmailState = {
  verifiedEmail: string | null;
  verifiedAt: number | null;
  pendingEmail: string | null;
  otpExpiresAt: number | null;
  otpAttempts: number;
};

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
