import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/invoice-generator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Non autorise" }, { status: 401 });

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, user: true },
  });

  if (!order) return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });

  if (session.user.role === "CLIENT" && order.userId !== session.user.id) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  if (order.status === "PENDING") {
    return NextResponse.json({ error: "Facture non disponible" }, { status: 400 });
  }

  const pdfBuffer = await generateInvoicePdf({
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    totalHT: order.subtotalHT,
    tvaAmount: order.tvaAmount,
    totalTTC: order.totalTTC,
    shippingCost: order.carrierPrice,
    clientName: `${order.shipFirstName} ${order.shipLastName}`,
    clientCompany: order.clientCompany || "",
    clientEmail: order.clientEmail,
    clientAddress: order.shipAddress1,
    clientCity: order.shipCity,
    clientZip: order.shipZipCode,
    clientCountry: order.shipCountry,
    items: order.items.map((i) => ({
      productName: i.productName,
      productRef: i.productRef,
      colorName: i.colorName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="facture-${order.orderNumber}.pdf"`,
    },
  });
}
