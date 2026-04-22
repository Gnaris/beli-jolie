import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCachedShopName,
  getCachedCompanyInfo,
  getCachedResendConfig,
} from "@/lib/cached-data";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/unlock-request
 *
 * Envoie une demande de déblocage par email à l'admin
 * quand un compte est verrouillé définitivement.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = (await request.json()) as { email?: string };

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email requis." }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Vérifier que le compte est bien verrouillé
    const lockout = await prisma.accountLockout.findUnique({
      where: { email: normalizedEmail },
    });

    if (!lockout?.permanent) {
      // Ne pas révéler si le compte existe ou non
      return NextResponse.json({ success: true });
    }

    // Envoyer l'email à l'admin
    const [shopName, companyInfo, resendCfg] = await Promise.all([
      getCachedShopName(),
      getCachedCompanyInfo(),
      getCachedResendConfig(),
    ]);
    const notifyEmail =
      resendCfg.notifyEmail || companyInfo?.email || process.env.NOTIFY_EMAIL;

    if (notifyEmail) {
      await sendMail({
        fromName: shopName,
        to: notifyEmail,
        subject: `Demande de déblocage — ${normalizedEmail}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#EF4444;">Demande de déblocage de compte</h2>
            <p>Le compte <strong>${normalizedEmail}</strong> a été bloqué définitivement
            suite à de trop nombreuses tentatives de connexion échouées.</p>
            <p>L'utilisateur demande un déblocage.</p>
            <div style="margin-top:20px;">
              <a href="${process.env.NEXTAUTH_URL}/admin/utilisateurs"
                 style="background:#1A1A1A;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
                Gérer les utilisateurs →
              </a>
            </div>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[POST /api/auth/unlock-request]", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
