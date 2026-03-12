import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchEasyExpressLabel } from "@/lib/easy-express";

/**
 * GET /api/admin/commandes/[id]/label
 *
 * Proxy sécurisé : télécharge le bordereau d'expédition Easy-Express
 * et le sert à l'admin en téléchargement direct.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { orderNumber: true, eeLabelUrl: true },
  });

  if (!order) return new NextResponse("Commande introuvable", { status: 404 });

  if (!order.eeLabelUrl) {
    return new NextResponse("Aucun bordereau disponible pour cette commande.", { status: 404 });
  }

  const buffer = await fetchEasyExpressLabel(order.eeLabelUrl);
  if (!buffer) {
    return new NextResponse("Impossible de récupérer le bordereau.", { status: 502 });
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="bordereau-${order.orderNumber}.pdf"`,
      "Content-Length":      String(buffer.length),
    },
  });
}
