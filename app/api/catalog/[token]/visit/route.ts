import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  CATALOG_CONTEXT_COOKIE_NAME,
  CATALOG_CONTEXT_TTL_MS,
  signCatalogContext,
} from "@/lib/catalog-context-cookie";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Enregistre une visite du catalogue partagé + pose un cookie de contexte
 * signé HMAC. Appelé une fois côté client au mount de la page publique.
 *
 * Le catalogId ne vient JAMAIS du client — il est résolu ici depuis le token
 * en BDD. Le cookie sert ensuite à l'action `addToCart` pour attribuer un
 * ajout au bon catalogue sans jamais faire confiance au client.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { token } = await ctx.params;

    const catalog = await prisma.catalog.findUnique({
      where: { token },
      select: { id: true, status: true },
    });
    // On enregistre seulement les visites de catalogues actifs — un catalogue
    // désactivé renvoie déjà 404 sur la page, aucune raison d'accumuler des
    // stats fantômes.
    if (!catalog || catalog.status !== "ACTIVE") {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;

    await prisma.catalogView.create({
      data: { catalogId: catalog.id, userId },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(CATALOG_CONTEXT_COOKIE_NAME, signCatalogContext(catalog.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(CATALOG_CONTEXT_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    logger.warn("[catalog-visit] failed", { err: String(err) });
    // Ne casse jamais l'UX — la page est déjà rendue, on avale l'erreur.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
