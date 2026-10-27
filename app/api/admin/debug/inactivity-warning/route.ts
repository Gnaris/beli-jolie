/**
 * Route admin DEV ONLY — simule l'envoi du mail d'avertissement
 * d'inactivité à un client, avec attente de X secondes.
 *
 * Usage (depuis le navigateur, connecté en admin) :
 *   GET /api/admin/debug/inactivity-warning?email=xxx@yyy.com&delaySec=10
 *
 * Faits :
 *  1. Backdate le user (createdAt = il y a 2 ans) + reset flags.
 *  2. Attend delaySec secondes.
 *  3. Pose inactivityWarningAt + envoie le mail « Avertissement avant
 *     désactivation ».
 *
 * Protégé par requireAdmin() — refus 403 si pas admin.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { notifyClientInactivityWarning } from "@/lib/notifications";
import { parseGraceDays } from "@/lib/inactive-client-revoke-config";

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireAdmin();

    const email = req.nextUrl.searchParams.get("email")?.toLowerCase().trim();
    const delaySecRaw = req.nextUrl.searchParams.get("delaySec") ?? "10";
    const delaySec = Math.max(0, Math.min(60, Number(delaySecRaw)));

    if (!email) {
      return NextResponse.json({ error: "email requis" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email, tenantId: tenant.id, role: "CLIENT" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!user) {
      return NextResponse.json(
        { error: `Client introuvable : ${email}` },
        { status: 404 },
      );
    }

    const graceRow = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "inactive_revoke_grace_days" },
      select: { value: true },
    });
    const graceDays = parseGraceDays(graceRow?.value);
    if (graceDays === null) {
      return NextResponse.json(
        {
          error:
            "Configure d'abord le délai de grâce dans /admin/parametres.",
        },
        { status: 400 },
      );
    }

    // 1) Backdate + reset flags.
    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: "APPROVED",
        createdAt: twoYearsAgo,
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
        probationUntil: null,
        inactiveClientOptOut: false,
      },
    });

    // 2) Attente.
    if (delaySec > 0) {
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }

    // 3) Pose la date d'avertissement + envoi mail.
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { inactivityWarningAt: now },
    });

    const daysInactive = 730;
    await notifyClientInactivityWarning({
      email: user.email,
      firstName: user.firstName,
      daysInactive,
      graceDays,
    });

    return NextResponse.json({
      ok: true,
      message: `Mail d'avertissement envoyé à ${user.email} après ${delaySec}s`,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
      },
      graceDays,
    });
  } catch (err) {
    logger.error("[debug/inactivity-warning]", { error: err as Error });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
