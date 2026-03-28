import nodemailer from "nodemailer";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedGmailConfig } from "@/lib/cached-data";

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createPasswordResetToken(email: string): Promise<string> {
  // Invalider les anciens tokens
  await prisma.passwordResetToken.updateMany({
    where: { email, used: false },
    data: { used: true },
  });
  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await prisma.passwordResetToken.create({
    data: { email, token, expiresAt },
  });
  return token;
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const [shopName, gmailCfg] = await Promise.all([getCachedShopName(), getCachedGmailConfig()]);
  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    console.warn("[password-reset] Configuration Gmail manquante.");
    return;
  }
  const { NEXTAUTH_URL } = process.env;
  const resetUrl = `${NEXTAUTH_URL}/reinitialiser-mot-de-passe?token=${token}`;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });
  await transporter.sendMail({
    from: `"${shopName}" <${GMAIL_USER}>`,
    to: email,
    subject: `Réinitialisation de votre mot de passe — ${shopName}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
        <h2 style="color:#1A1A1A;margin-bottom:8px">Réinitialisation du mot de passe</h2>
        <p style="color:#6B6B6B;margin-bottom:24px">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable <strong>1 heure</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Réinitialiser mon mot de passe</a>
        <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Votre mot de passe ne sera pas modifié.</p>
        <p style="color:#9CA3AF;font-size:11px;margin-top:8px">Lien direct : ${resetUrl}</p>
      </div>
    `,
  });
}
