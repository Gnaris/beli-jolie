import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOrderPDF } from "@/lib/pdf-order";
import { logger } from "@/lib/logger";

/**
 * GET /api/client/commandes/[id]/pdf?noPrices=1
 *
 * Generates the order PDF on the fly for the authenticated client.
 * ?noPrices=1 → version without prices.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const { id } = await params;
  const hidePrices = req.nextUrl.searchParams.get("noPrices") === "1";

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) return new NextResponse("Commande introuvable", { status: 404 });

  try {
    const pdfBuffer = await generateOrderPDF({
      orderNumber:     order.orderNumber,
      createdAt:       order.createdAt,
      clientCompany:   order.clientCompany,
      clientFirstName: order.shipFirstName,
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
      carrierPrice:    Number(order.carrierPrice),
      clientDiscountAmt: Number(order.clientDiscountAmt),
      promoCode:       order.promoCode,
      promoDiscount:   Number(order.promoDiscount),
      creditApplied:   Number(order.creditApplied),
      tvaRate:         order.tvaRate,
      subtotalHT:      Number(order.subtotalHT),
      tvaAmount:       Number(order.tvaAmount),
      totalTTC:        Number(order.totalTTC),
      hidePrices,
      items: order.items.map((item) => {
        let categoryName: string | null = null;
        if (item.variantSnapshot) {
          try {
            const snap = JSON.parse(item.variantSnapshot);
            categoryName = snap.categoryName ?? null;
          } catch { /* ignore */ }
        }

        return {
          productName:  item.productName,
          productRef:   item.productRef,
          colorName:    item.colorName,
          categoryName,
          saleType:     item.saleType,
          packQty:      item.packQty,
          size:         item.size,
          sizesJson:    item.sizesJson,
          packDetails:  item.packDetails,
          imagePath:    item.imagePath,
          unitPrice:    Number(item.unitPrice),
          quantity:     item.quantity,
          lineTotal:    Number(item.lineTotal),
        };
      }),
    });

    const suffix = hidePrices ? "-sans-prix" : "";
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="commande-${order.orderNumber}${suffix}.pdf"`,
        "Content-Length":      String(pdfBuffer.length),
      },
    });
  } catch (err) {
    logger.error("[pdf] Erreur génération PDF client", { error: err instanceof Error ? err.message : String(err) });
    return new NextResponse("Erreur génération PDF", { status: 500 });
  }
}
