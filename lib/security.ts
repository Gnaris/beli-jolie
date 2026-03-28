/**
 * lib/security.ts
 *
 * Couche de sécurité pour l'authentification
 *
 * 1. Login brute force : lockout progressif après 3 échecs
 *    Paliers : 1min, 5min, 15min, 20min, 1h, 3h, 6h, 12h, 24h, 48h, permanent
 *
 * 2. Inscription anti-spam : cooldown 3h par IP/phone/siret/email
 */

import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Login — Lockout progressif
// ─────────────────────────────────────────────

/** Durées de verrouillage en secondes par palier (index = lockoutLevel) */
const LOCKOUT_DURATIONS_SEC = [
  0,        // level 0 = pas de verrouillage (< 3 échecs)
  60,       // level 1 = 1 minute
  300,      // level 2 = 5 minutes
  900,      // level 3 = 15 minutes
  1200,     // level 4 = 20 minutes
  3600,     // level 5 = 1 heure
  10800,    // level 6 = 3 heures
  21600,    // level 7 = 6 heures
  43200,    // level 8 = 12 heures
  86400,    // level 9 = 24 heures
  172800,   // level 10 = 48 heures
  -1,       // level 11 = permanent
];

const MAX_ATTEMPTS_BEFORE_LOCKOUT = 3;

/**
 * Vérifie si un compte est verrouillé.
 * Retourne null si OK, ou un message d'erreur si verrouillé.
 */
export async function checkLoginLockout(email: string): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim();

  const lockout = await prisma.accountLockout.findUnique({
    where: { email: normalizedEmail },
  });

  if (!lockout) return null;

  // Blocage permanent
  if (lockout.permanent) {
    return "Votre compte est bloqué définitivement suite à de trop nombreuses tentatives. Veuillez demander un déblocage par email.";
  }

  // Vérifier si le verrouillage temporaire est encore actif
  if (lockout.lockedUntil && new Date() < lockout.lockedUntil) {
    const remaining = Math.ceil((lockout.lockedUntil.getTime() - Date.now()) / 1000);
    const formatted = formatDuration(remaining);
    return `Compte temporairement bloqué. Réessayez dans ${formatted}.`;
  }

  return null;
}

/**
 * Enregistre une tentative de connexion échouée.
 * Incrémente le compteur et applique le verrouillage si nécessaire.
 */
export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  // Log de la tentative
  await prisma.loginAttempt.create({
    data: { email: normalizedEmail, ip, success: false },
  });

  // Upsert le lockout
  const lockout = await prisma.accountLockout.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, failureCount: 1, lockoutLevel: 0 },
    update: { failureCount: { increment: 1 } },
  });

  const newFailureCount = lockout.failureCount + 1; // upsert retourne l'état AVANT l'update

  // Pas encore assez d'échecs
  if (newFailureCount < MAX_ATTEMPTS_BEFORE_LOCKOUT) return;

  // Calculer le nouveau palier
  const newLevel = Math.min(
    lockout.lockoutLevel + 1,
    LOCKOUT_DURATIONS_SEC.length - 1
  );
  const durationSec = LOCKOUT_DURATIONS_SEC[newLevel];

  if (durationSec === -1) {
    // Blocage permanent
    await prisma.accountLockout.update({
      where: { email: normalizedEmail },
      data: { lockoutLevel: newLevel, permanent: true, lockedUntil: null },
    });
  } else if (durationSec > 0) {
    const lockedUntil = new Date(Date.now() + durationSec * 1000);
    await prisma.accountLockout.update({
      where: { email: normalizedEmail },
      data: { lockoutLevel: newLevel, lockedUntil },
    });
  }
}

/**
 * Réinitialise le compteur après une connexion réussie.
 */
export async function recordLoginSuccess(email: string, ip: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  await prisma.loginAttempt.create({
    data: { email: normalizedEmail, ip, success: true },
  });

  // Reset le lockout
  await prisma.accountLockout.deleteMany({
    where: { email: normalizedEmail },
  });
}

// ─────────────────────────────────────────────
// Inscription — Anti-spam (cooldown 3h)
// ─────────────────────────────────────────────

const REGISTRATION_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 heures

/**
 * Vérifie si une inscription est autorisée (pas de spam).
 * Contrôle IP, email, phone, siret, company.
 * Retourne null si OK, ou un message d'erreur.
 */
export async function checkRegistrationSpam(
  ip: string,
  email: string,
  phone: string,
  siret: string,
): Promise<string | null> {
  const since = new Date(Date.now() - REGISTRATION_COOLDOWN_MS);

  // Vérifier chaque critère en parallèle
  const [byIp, byPhone, bySiret, byEmail] = await Promise.all([
    prisma.registrationLog.count({
      where: { ip, createdAt: { gte: since } },
    }),
    prisma.registrationLog.count({
      where: { phone, createdAt: { gte: since } },
    }),
    prisma.registrationLog.count({
      where: { siret, createdAt: { gte: since } },
    }),
    prisma.registrationLog.count({
      where: { email: email.toLowerCase().trim(), createdAt: { gte: since } },
    }),
  ]);

  if (byIp > 0) {
    return "Une inscription a déjà été effectuée depuis cette adresse récemment. Veuillez réessayer dans quelques heures.";
  }
  if (byEmail > 0) {
    return "Une inscription avec cet email a déjà été effectuée récemment.";
  }
  if (byPhone > 0) {
    return "Une inscription avec ce numéro de téléphone a déjà été effectuée récemment.";
  }
  if (bySiret > 0) {
    return "Une inscription avec ce SIRET a déjà été effectuée récemment.";
  }

  return null;
}

/**
 * Enregistre une inscription réussie dans le log anti-spam.
 */
export async function logRegistration(
  ip: string,
  email: string,
  phone: string,
  siret: string,
  company: string
): Promise<void> {
  await prisma.registrationLog.create({
    data: { ip, email: email.toLowerCase().trim(), phone, siret, company },
  });
}

// ─────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconde${seconds > 1 ? "s" : ""}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} heure${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} jour${days > 1 ? "s" : ""}`;
}

/**
 * Extrait l'IP du client depuis les headers de la requête.
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
