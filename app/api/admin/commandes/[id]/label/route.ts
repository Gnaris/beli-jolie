import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchEasyExpressLabel } from "@/lib/easy-express";
import { fetchSmarty365Label } from "@/lib/smarty365";

/**
 * GET /api/admin/commandes/[id]/label
 *
 * Proxy sécurisé : télécharge le bordereau d'expédition depuis Easy-Express
 * ou Smarty365 selon le fournisseur associé à la commande, et le sert en
 * téléchargement direct à l'admin.
 *
 * Priorité :
 *   1. Order.shippingProvider = "smarty365" → Smarty365
 *   2. Order.shippingProvider = "easy_express" → Easy-Express
 *   3. Fallback : la présence de smartyLabelUrl vs eeLabelUrl.
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
    select: {
      orderNumber: true,
      shippingProvider: true,
      eeLabelUrl: true,
      smartyLabelUrl: true,
    },
  });

  if (!order) return new NextResponse("Commande introuvable", { status: 404 });

  // Résolution du fournisseur pour ce téléchargement.
  const useSmarty =
    order.shippingProvider === "smarty365" ||
    (!order.shippingProvider && !!order.smartyLabelUrl);

  const targetUrl = useSmarty ? order.smartyLabelUrl : order.eeLabelUrl;

  if (!targetUrl) {
    return new NextResponse("Aucun bordereau disponible pour cette commande.", { status: 404 });
  }

  const buffer = useSmarty
    ? await fetchSmarty365Label(targetUrl)
    : await fetchEasyExpressLabel(targetUrl);

  if (!buffer) {
    return new NextResponse("Impossible de récupérer le bordereau.", { status: 502 });
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="bordereau-${order.orderNumber}.pdf"`,
      "Content-Length":      String(buffer.length),
    },
  });
}
