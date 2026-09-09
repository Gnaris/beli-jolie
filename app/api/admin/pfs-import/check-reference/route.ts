import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
import { pickDefaultImage } from "@/lib/pfs-import";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const reference = (body.reference ?? "").trim().toUpperCase();

    if (!reference) {
      return NextResponse.json({ valid: false, error: "Référence vide" });
    }

    // 1 — Check if product already exists locally
    const existing = await prisma.product.findFirst({
      where: { reference },
      select: { id: true, name: true },
    });

    if (existing) {
      return NextResponse.json({
        valid: false,
        error: `Ce produit existe déjà dans votre boutique (${existing.name})`,
      });
    }

    // 2 — Check if product exists on PFS
    const pfsResult = await pfsCheckReference(reference);

    if (!pfsResult.exists || !pfsResult.product) {
      return NextResponse.json({
        valid: false,
        error: "Cette référence n'existe pas sur Paris Fashion Shop",
      });
    }

    const p = pfsResult.product;

    // PFS matche parfois par préfixe/substring et renvoie un produit dont la
    // référence n'est PAS celle demandée (ex: "13369ROBE" → "13369"). On
    // vérifie ici strictement l'égalité (insensible à la casse et aux
    // espaces) pour ne jamais importer un produit à la place d'un autre.
    const returnedRefNorm = (p.reference ?? "").trim().toUpperCase();
    if (returnedRefNorm !== reference) {
      return NextResponse.json({
        valid: false,
        error: `La référence exacte « ${reference} » n'existe pas sur Paris Fashion Shop. PFS a proposé « ${p.reference} » mais on refuse pour éviter d'importer le mauvais produit.`,
      });
    }

    const name = p.label?.fr || p.label?.en || Object.values(p.label ?? {})[0] || reference;

    return NextResponse.json({
      valid: true,
      product: {
        pfsId: p.id,
        reference: p.reference,
        name,
        defaultImage: pickDefaultImage(p.images),
      },
    });
  } catch (err) {
    logger.error("[PFS Import] check-reference failed", { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
