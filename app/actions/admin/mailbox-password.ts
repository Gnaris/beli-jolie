"use server";

/**
 * app/actions/admin/mailbox-password.ts
 *
 * Reset du mot de passe de la boîte pro `contact@<domaine>` avec OTP envoyé
 * à l'email perso configuré dans « Paramètres > Messagerie ». Objectif
 * sécurité : même si un hacker prend le contrôle du panel admin, il ne peut
 * pas changer le mot de passe de la boîte pro sans aussi avoir accès au
 * mail perso de la propriétaire.
 *
 * Flux :
 *   1. Étape 1 (`requestMailboxPasswordResetOtp`) : envoie un code 6 chiffres
 *      à `mail_notify_email` (perso). Stocke le hash dans AdminActionOtp.
 *   2. Étape 2 (`verifyAndResetMailboxPassword`) : vérifie le code, génère
 *      un hash SHA512-CRYPT via `doveadm pw`, met à jour /etc/dovecot/users
 *      + SiteConfig.smtp_password (chiffré), reload dovecot.
 *
 * Environnement :
 *   - Linux (prod) : applique vraiment le changement sur Dovecot.
 *   - Autre (Windows/localhost) : refuse — l'opération n'a pas de sens en
 *     dev car le serveur mail n'est que sur le VPS.
 */

import crypto from "crypto";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { setSiteConfig } from "@/lib/site-config-write";
import { encryptValue, decryptIfSensitive } from "@/lib/encryption";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { headers } from "next/headers";
import {
  generateOtpCode,
  hashOtpCode,
  maskEmail,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
} from "@/lib/admin-action-otp";

const execFile = promisify(execFileCb);
const OTP_ACTION = "mailbox_pwd_reset";
const DOVECOT_USERS_PATH = "/etc/dovecot/users";

const PWD_MIN = 12;
const PWD_MAX = 128;

async function requireAdmin(): Promise<{ id: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
  return { id: session.user.id };
}

async function resolveTenantId(): Promise<string> {
  const fromAls = getCurrentTenantIdSync();
  if (fromAls) return fromAls;
  const h = await headers();
  const fromHeader = h.get("x-tenant-id");
  if (fromHeader) return fromHeader;
  throw new Error("Tenant introuvable.");
}

async function readPersoEmail(tenantId: string): Promise<string | null> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "mail_notify_email" },
    select: { value: true },
  });
  const val = row?.value?.trim();
  return val || null;
}

async function readMailboxUser(tenantId: string): Promise<string | null> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "smtp_user" },
    select: { value: true },
  });
  if (!row?.value) return null;
  const decrypted = decryptIfSensitive("smtp_user", row.value).trim();
  return decrypted || null;
}

// ─────────────────────────────────────────────────────────────────────
// ÉTAPE 1 : Demander un OTP
// ─────────────────────────────────────────────────────────────────────

export type RequestOtpResult =
  | { success: true; otpId: string; recipientMasked: string; expiresAt: number }
  | { success: false; error: string };

export async function requestMailboxPasswordResetOtp(): Promise<RequestOtpResult> {
  try {
    const admin = await requireAdmin();
    const tenantId = await resolveTenantId();

    const persoEmail = await readPersoEmail(tenantId);
    if (!persoEmail) {
      return {
        success: false,
        error:
          "Aucun email perso configuré. Renseignez d'abord une adresse dans « Adresse email où recevoir » puis enregistrez.",
      };
    }
    const mailboxUser = await readMailboxUser(tenantId);
    if (!mailboxUser) {
      return {
        success: false,
        error: "Aucune boîte mail pro configurée pour cette boutique.",
      };
    }

    // Invalide les anciens OTP non consommés du même admin+action
    await prisma.adminActionOtp.updateMany({
      where: { adminId: admin.id, tenantId, action: OTP_ACTION, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const otp = await prisma.adminActionOtp.create({
      data: {
        adminId: admin.id,
        tenantId,
        action: OTP_ACTION,
        productIds: [],
        codeHash,
        expiresAt,
      },
    });

    const mail = await sendMail({
      to: persoEmail,
      subject: `🔐 Code de réinitialisation — mot de passe boîte mail pro`,
      html: buildOtpEmailHtml({ code, mailboxUser }),
    });

    if (!mail.sent) {
      logger.warn("[MailboxPwd] Envoi OTP échoué", {
        to: persoEmail,
        reason: mail.reason,
      });
      return { success: false, error: "L'envoi du code par mail a échoué. Réessayez." };
    }

    logger.info("[MailboxPwd] OTP créé et envoyé", {
      otpId: otp.id,
      to: maskEmail(persoEmail),
      mailboxUser,
    });

    return {
      success: true,
      otpId: otp.id,
      recipientMasked: maskEmail(persoEmail),
      expiresAt: expiresAt.getTime(),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// ÉTAPE 2 : Vérifier + appliquer
// ─────────────────────────────────────────────────────────────────────

export type ResetResult =
  | { success: true; mailboxUser: string }
  | { success: false; error: string };

export async function verifyAndResetMailboxPassword(params: {
  otpId: string;
  code: string;
  newPassword: string;
  newPasswordConfirm: string;
}): Promise<ResetResult> {
  try {
    const admin = await requireAdmin();
    const tenantId = await resolveTenantId();

    // ── 1. Validations du nouveau mdp ──
    if (params.newPassword !== params.newPasswordConfirm) {
      return { success: false, error: "Les mots de passe ne correspondent pas." };
    }
    if (params.newPassword.length < PWD_MIN || params.newPassword.length > PWD_MAX) {
      return {
        success: false,
        error: `Le mot de passe doit contenir entre ${PWD_MIN} et ${PWD_MAX} caractères.`,
      };
    }
    // Interdit les caractères problématiques pour le fichier /etc/dovecot/users
    if (/[\n\r\t:]/.test(params.newPassword)) {
      return {
        success: false,
        error: "Le mot de passe ne peut pas contenir de retour à la ligne, tabulation ou « : ».",
      };
    }

    // ── 2. Vérifier l'OTP ──
    const otp = await prisma.adminActionOtp.findFirst({
      where: { id: params.otpId, adminId: admin.id, tenantId },
    });
    if (!otp) return { success: false, error: "Code introuvable ou expiré." };
    if (otp.usedAt) return { success: false, error: "Code déjà utilisé." };
    if (otp.action !== OTP_ACTION) return { success: false, error: "Code invalide." };
    if (otp.expiresAt.getTime() < Date.now()) {
      return { success: false, error: "Code expiré. Redemandez un nouveau code." };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.adminActionOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      });
      return { success: false, error: "Trop de tentatives. Redemandez un nouveau code." };
    }

    const expected = hashOtpCode(params.code.trim());
    const providedBuf = Buffer.from(expected, "hex");
    const storedBuf = Buffer.from(otp.codeHash, "hex");
    const sameLen = providedBuf.length === storedBuf.length;
    const matches = sameLen && crypto.timingSafeEqual(providedBuf, storedBuf);
    if (!matches) {
      const newAttempts = otp.attempts + 1;
      await prisma.adminActionOtp.update({
        where: { id: otp.id },
        data: {
          attempts: newAttempts,
          usedAt: newAttempts >= OTP_MAX_ATTEMPTS ? new Date() : null,
        },
      });
      return {
        success: false,
        error:
          newAttempts >= OTP_MAX_ATTEMPTS
            ? "Trop de tentatives. Redemandez un nouveau code."
            : `Code incorrect. Il reste ${OTP_MAX_ATTEMPTS - newAttempts} essai(s).`,
      };
    }

    // ── 3. Marquer OTP consommé ──
    await prisma.adminActionOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    // ── 4. Environnement ──
    if (process.platform !== "linux") {
      return {
        success: false,
        error:
          "Cette opération n'est possible que depuis l'admin en production (https://beliandjolie.com/admin/parametres?tab=messagerie).",
      };
    }

    const mailboxUser = await readMailboxUser(tenantId);
    if (!mailboxUser) {
      return { success: false, error: "Aucune boîte mail pro configurée." };
    }

    // ── 5. Générer le hash SHA512-CRYPT via doveadm ──
    let newHash: string;
    try {
      const { stdout } = await execFile("doveadm", ["pw", "-s", "SHA512-CRYPT", "-p", params.newPassword], {
        timeout: 15_000,
      });
      newHash = stdout.trim();
      if (!newHash.startsWith("{SHA512-CRYPT}")) {
        throw new Error("Hash Dovecot inattendu");
      }
    } catch (err) {
      logger.error("[MailboxPwd] doveadm pw échoué", { error: err as Error });
      return {
        success: false,
        error: "Impossible de générer le hash Dovecot. Contactez le support.",
      };
    }

    // ── 6. Réécrire /etc/dovecot/users (remplace la ligne du user) ──
    try {
      const raw = await fs.readFile(DOVECOT_USERS_PATH, "utf8");
      const lines = raw.split(/\r?\n/);
      let found = false;
      const updated = lines.map((line) => {
        if (!line.trim()) return line;
        const [user] = line.split(":");
        if (user === mailboxUser) {
          found = true;
          return `${mailboxUser}:${newHash}::::::`;
        }
        return line;
      });
      if (!found) {
        return { success: false, error: `Utilisateur ${mailboxUser} introuvable dans /etc/dovecot/users.` };
      }
      await fs.writeFile(DOVECOT_USERS_PATH, updated.join("\n"), { mode: 0o640 });
    } catch (err) {
      logger.error("[MailboxPwd] Écriture /etc/dovecot/users échouée", { error: err as Error });
      return { success: false, error: "Impossible de mettre à jour le fichier des mots de passe." };
    }

    // ── 7. Reload dovecot ──
    try {
      await execFile("systemctl", ["reload", "dovecot"], { timeout: 15_000 });
    } catch (err) {
      logger.error("[MailboxPwd] systemctl reload dovecot échoué", { error: err as Error });
      return { success: false, error: "Impossible de recharger le serveur mail. Le fichier a été mis à jour mais le rechargement a échoué." };
    }

    // ── 8. Mettre à jour smtp_password (chiffré) ──
    try {
      await setSiteConfig("smtp_password", encryptValue(params.newPassword), { tenantId });
    } catch (err) {
      logger.error("[MailboxPwd] Mise à jour SiteConfig échouée", { error: err as Error });
      // Non-bloquant : la boîte marche déjà côté Dovecot, on log et continue
    }

    logger.info("[MailboxPwd] Mot de passe boîte pro réinitialisé", {
      adminId: admin.id,
      mailboxUser,
    });

    revalidatePath("/admin/parametres");
    return { success: true, mailboxUser };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Email HTML de l'OTP
// ─────────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOtpEmailHtml(p: { code: string; mailboxUser: string }): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;padding:16px;background:#F1F5F9">
      <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
        <div style="padding:20px 24px;border-bottom:1px solid #E2E8F0;background:#FFF7ED">
          <div style="font-size:11px;color:#9A3412;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">🔐 Sécurité — Boîte mail pro</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">
            Code de réinitialisation
          </div>
        </div>
        <div style="padding:28px 24px;font-size:14px;line-height:1.6;color:#334155">
          <p style="margin:0 0 16px">Bonjour,</p>
          <p style="margin:0 0 16px">
            Vous venez de demander à réinitialiser le mot de passe de la boîte
            <strong>${escapeHtml(p.mailboxUser)}</strong> depuis votre admin.
          </p>
          <div style="margin:20px 0;padding:24px;border-radius:12px;background:#FFF7ED;border:2px solid #FED7AA;text-align:center">
            <div style="font-size:11px;color:#9A3412;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Votre code</div>
            <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:700;color:#9A3412;letter-spacing:10px">${escapeHtml(p.code)}</div>
            <div style="font-size:11px;color:#9A3412;margin-top:12px;opacity:0.7">Expire dans 15 minutes</div>
          </div>
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px;margin:20px 0">
            <div style="font-size:12px;color:#991B1B;line-height:1.5">
              <strong>⚠️ Vous n'êtes pas à l'origine de cette demande ?</strong><br />
              Ignorez ce mail — le mot de passe ne sera pas changé sans ce code. Contactez le support immédiatement.
            </div>
          </div>
          <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">
            Code à usage unique, valable 15 minutes, ${OTP_CODE_LENGTH} chiffres.
          </p>
        </div>
      </div>
    </div>
  `;
}
