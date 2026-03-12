import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderPDF } from "@/lib/pdf-order";

/**
 * GET /api/admin/commandes/[id]/pdf
 *
 * Génère et sert le bon de commande PDF à la volée.
 * Réservé aux admins.
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
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) return new NextResponse("Commande introuvable", { status: 404 });

  try {
    const pdfBuffer = await generateOrderPDF({
      orderNumber:     order.orderNumber,
      createdAt:       order.createdAt,
      clientCompany:   order.clientCompany,
      clientFirstName: order.shipFirstName, // utilise le contact livraison comme prénom client
      clientLastName:  order.shipLastName,
      clientEmail:     order.clientEmail,
      clientPhone:     order.clientPhone,
      clientSiret:     order.clientSiret,
      clientVatNumber: order.clientVatNumber,
      shipLabel:       order.shipLabel,
      shipFirstName:   order.shipFirstName,
      shipLastName:    order.shipLastName,
      shipCompany:     order.shipCompany,
      shipAddress1:    order.shipAddress1,
      shipAddress2:    order.shipAddress2,
      shipZipCode:     order.shipZipCode,
      shipCity:        order.shipCity,
      shipCountry:     order.shipCountry,
      carrierName:     order.carrierName,
      carrierPrice:    order.carrierPrice,
      tvaRate:         order.tvaRate,
      subtotalHT:      order.subtotalHT,
      tvaAmount:       order.tvaAmount,
      totalTTC:        order.totalTTC,
      items: order.items.map((item) => ({
        productName: item.productName,
        productRef:  item.productRef,
        colorName:   item.colorName,
        saleType:    item.saleType,
        packQty:     item.packQty,
        size:        item.size,
        imagePath:   item.imagePath,
        unitPrice:   item.unitPrice,
        quantity:    item.quantity,
        lineTotal:   item.lineTotal,
      })),
    });

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="commande-${order.orderNumber}.pdf"`,
        "Content-Length":      String(pdfBuffer.length),
      },
    });
  } catch (err) {
    console.error("[pdf] Erreur génération PDF:", err);
    return new NextResponse("Erreur génération PDF", { status: 500 });
  }
}
