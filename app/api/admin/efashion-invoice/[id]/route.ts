import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { efashionGetInvoicePdf } from "@/lib/efashion-orders-api";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/efashion-invoice/[id]
 * Proxy authentifié qui télécharge la facture PDF depuis eFashion et la sert
 * au navigateur. Nécessaire parce que l'URL de facture eFashion exige un cookie
 * de session vendeur (non exposable côté client).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const buf = await efashionGetInvoicePdf(id);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="facture-efashion-${id}.pdf"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    logger.error("[eFashion Invoice] Téléchargement échoué", {
      efashionOrderId: id,
      error: err as Error,
    });
    return NextResponse.json({ error: "Facture indisponible" }, { status: 502 });
  }
}
