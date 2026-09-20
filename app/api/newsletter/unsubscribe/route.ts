/**
 * GET /api/newsletter/unsubscribe?t=<token>
 *
 * Endpoint de désinscription newsletter. Le lien est inséré dans chaque mail
 * marketing (variable `{unsubscribeLink}`, injectée par `send-newsletter.ts`
 * et `user-mails.ts` à partir de `buildUnsubscribeUrl`).
 *
 * 1 clic = `User.acceptsNewsletter = false` — pas de re-connexion demandée
 * (obligation RGPD/LCEN : désinscription en 1 clic, gratuite).
 *
 * Rend une page HTML autonome (pas de layout, pas de i18n) : le destinataire
 * n'a pas de session, on ne veut pas déclencher un chargement de front lourd.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifyUnsubscribeToken } from "@/lib/newsletter-unsubscribe-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlPage({
  title,
  bodyHtml,
  accent = "#0f172a",
}: {
  title: string;
  bodyHtml: string;
  accent?: string;
}): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Roboto:wght@400;600&display=swap" rel="stylesheet">
<style>
  html, body { margin:0; padding:0; }
  body { background:#f1f5f9; font-family:'Roboto', -apple-system, sans-serif; color:#0f172a; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 12px; }
  .card { max-width:560px; width:100%; background:#fff; border-radius:16px; box-shadow:0 6px 32px rgba(15,23,42,.08); padding:40px 32px; text-align:center; }
  h1 { font-family:'Poppins', sans-serif; font-size:22px; font-weight:700; margin:0 0 12px; color:${accent}; }
  p { font-size:14px; line-height:1.6; color:#475569; margin:0 0 12px; }
  .badge { display:inline-block; width:72px; height:72px; border-radius:50%; background:${accent}12; color:${accent}; font-size:32px; line-height:72px; margin-bottom:16px; }
</style>
</head>
<body>
<div class="card">${bodyHtml}</div>
</body>
</html>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  if (!token) {
    return new NextResponse(
      htmlPage({
        title: "Lien invalide",
        bodyHtml: `
          <div class="badge">⚠</div>
          <h1>Lien invalide</h1>
          <p>Ce lien de désinscription est mal formé. Contactez la boutique si vous souhaitez vous désinscrire.</p>
        `,
        accent: "#b91c1c",
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const check = verifyUnsubscribeToken(token);
  if (!check.valid) {
    const message =
      check.reason === "expired"
        ? "Ce lien de désinscription a expiré. Contactez la boutique pour être désinscrit."
        : "Ce lien de désinscription n'est pas valide.";
    return new NextResponse(
      htmlPage({
        title: "Lien invalide",
        bodyHtml: `
          <div class="badge">⚠</div>
          <h1>${check.reason === "expired" ? "Lien expiré" : "Lien invalide"}</h1>
          <p>${message}</p>
        `,
        accent: "#b91c1c",
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // On vérifie que l'user existe bien et appartient au tenant du token
  // (défense en profondeur : l'extension Prisma est bypass ici puisqu'on n'a
  // pas de contexte ALS de tenant hors-request).
  try {
    const user = await prisma.user.findFirst({
      where: { id: check.userId, tenantId: check.tenantId },
      select: { id: true, email: true, acceptsNewsletter: true },
    });
    if (!user) {
      return new NextResponse(
        htmlPage({
          title: "Introuvable",
          bodyHtml: `
            <div class="badge">?</div>
            <h1>Compte introuvable</h1>
            <p>Nous n'avons pas trouvé de compte correspondant à ce lien.</p>
          `,
          accent: "#b91c1c",
        }),
        { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // 1 clic = désinscription globale (newsletter + relances panier + relances
    // inactivité). Sinon le client resterait relancé après avoir cliqué sur
    // "se désinscrire" — non-conforme RGPD.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        acceptsNewsletter: false,
        abandonedCartOptOut: true,
        inactiveClientOptOut: true,
      },
    });
    // Annule tout job de relance en cours (fire-and-forget, tenant scope via
    // le predicate userId qui reste unique).
    await Promise.all([
      prisma.abandonedCartJob
        .updateMany({
          where: {
            userId: user.id,
            tenantId: check.tenantId,
            status: "PENDING",
          },
          data: {
            status: "CANCELLED",
            nextStageAt: null,
            cancelReason: "OPT_OUT",
          },
        })
        .catch(() => undefined),
      prisma.inactiveClientJob
        .updateMany({
          where: {
            userId: user.id,
            tenantId: check.tenantId,
            status: "PENDING",
          },
          data: {
            status: "CANCELLED",
            cancelReason: "OPT_OUT",
          },
        })
        .catch(() => undefined),
    ]);
    logger.info?.("[newsletter/unsubscribe] user unsubscribed", {
      userId: user.id,
      tenantId: check.tenantId,
    });

    return new NextResponse(
      htmlPage({
        title: "Désinscription confirmée",
        bodyHtml: `
          <div class="badge" style="background:#dcfce7;color:#166534;">✓</div>
          <h1>Désinscription confirmée</h1>
          <p>Vous ne recevrez plus de mails commerciaux de notre part.</p>
          <p style="font-size:12px;color:#94a3b8;margin-top:20px;">Vous continuerez à recevoir les mails liés à vos commandes en cours (facture, expédition…).</p>
        `,
        accent: "#166534",
      }),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    logger.error("[newsletter/unsubscribe] error", { error: err as Error });
    return new NextResponse(
      htmlPage({
        title: "Erreur",
        bodyHtml: `
          <div class="badge">⚠</div>
          <h1>Une erreur est survenue</h1>
          <p>Merci de réessayer plus tard ou de contacter la boutique.</p>
        `,
        accent: "#b91c1c",
      }),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
