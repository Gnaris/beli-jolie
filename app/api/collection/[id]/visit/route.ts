import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  COLLECTION_CONTEXT_COOKIE_NAME,
  COLLECTION_CONTEXT_TTL_MS,
  signCollectionContext,
} from "@/lib/collection-context-cookie";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Enregistre une visite de collection publique et pose le cookie de contexte
 * signé HMAC. Un query `?mode=context` saute l'enregistrement de la vue —
 * utilisé quand une visiteuse arrive directement sur une fiche produit via
 * `?via=collection:<id>` (ex: email) : elle n'a pas vu la page collection
 * elle-même, on pose juste le contexte pour attribuer un éventuel ajout.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const mode = req.nextUrl.searchParams.get("mode");
    const skipView = mode === "context";

    const collection = await prisma.collection.findFirst({
      where: { id, visible: true },
      select: { id: true },
    });
    if (!collection) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    if (!skipView) {
      const session = await getServerSession(authOptions);
      const userId = session?.user?.id ?? null;
      await prisma.collectionView.create({
        data: { collectionId: collection.id, userId },
      });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COLLECTION_CONTEXT_COOKIE_NAME, signCollectionContext(collection.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(COLLECTION_CONTEXT_TTL_MS / 1000),
    });
    return res;
  } catch (err) {
    logger.warn("[collection-visit] failed", { err: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
