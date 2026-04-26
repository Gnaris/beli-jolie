import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsCheckReference } from "@/lib/pfs-api";
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
    const name = p.label?.fr || p.label?.en || Object.values(p.label ?? {})[0] || reference;

    return NextResponse.json({
      valid: true,
      product: {
        pfsId: p.id,
        reference: p.reference,
        name,
      },
    });
  } catch (err) {
    logger.error("[PFS Import] check-reference failed", { err: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
