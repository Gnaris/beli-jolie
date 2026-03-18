import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/access-code/track
 *
 * Enregistre une visite de page/produit pour un visiteur avec code d'accès.
 * Body: { pageUrl: string, productId?: string, productName?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const code = request.cookies.get("bj_access_code")?.value;
    if (!code) {
      return NextResponse.json({ error: "Pas de code d'accès." }, { status: 401 });
    }

    const accessCode = await prisma.accessCode.findUnique({
      where: { code },
      select: { id: true, isActive: true, expiresAt: true, usedBy: true },
    });

    if (!accessCode || !accessCode.isActive || new Date() > accessCode.expiresAt) {
      return NextResponse.json({ error: "Code invalide." }, { status: 403 });
    }

    const body = (await request.json()) as {
      pageUrl?: string;
      productId?: string;
      productName?: string;
    };

    if (!body.pageUrl || typeof body.pageUrl !== "string") {
      return NextResponse.json({ error: "pageUrl requis." }, { status: 400 });
    }

    // Enregistrer la vue
    await prisma.accessCodeView.create({
      data: {
        accessCodeId: accessCode.id,
        pageUrl: body.pageUrl.slice(0, 500),
        productId: body.productId || null,
        productName: body.productName?.slice(0, 200) || null,
      },
    });

    // Mettre à jour lastAccessAt
    await prisma.accessCode.update({
      where: { id: accessCode.id },
      data: { lastAccessAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/access-code/track]", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
