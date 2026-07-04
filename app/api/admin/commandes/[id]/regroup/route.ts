import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/admin/commandes/[id]/regroup
// Endpoint JSON consommé par l'extension Chrome « Regroupement facture ».
// Auth admin par cookie de session (l'extension appelle avec credentials: include).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
  }

  const refs = Array.from(
    new Set(order.items.map((it) => it.productRef).filter(Boolean)),
  );
  const products =
    refs.length > 0
      ? await prisma.product.findMany({
          where: { reference: { in: refs } },
          select: {
            reference: true,
            category: { select: { name: true } },
          },
        })
      : [];
  const catByRef = new Map<string, string>();
  for (const p of products) {
    if (p.category?.name) catByRef.set(p.reference, p.category.name);
  }

  const items = order.items.map((it) => ({
    categorie: catByRef.get(it.productRef) ?? "Sans catégorie",
    prixUnitaire: Number(it.unitPrice),
    quantite: it.quantity,
  }));

  return NextResponse.json({
    orderNo: order.orderNumber,
    subtotalHT: Number(order.subtotalHT),
    totalTTC: Number(order.totalTTC),
    items,
    shipping: {
      company: order.shipCompany ?? null,
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      address1: order.shipAddress1,
      address2: order.shipAddress2 ?? null,
      zipCode: order.shipZipCode,
      city: order.shipCity,
      country: order.shipCountry,
      email: order.clientEmail,
      phone: order.clientPhone,
      vatNumber: order.clientVatNumber ?? null,
    },
    billing: {
      company: order.clientCompany,
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      address1: order.shipAddress1,
      address2: order.shipAddress2 ?? null,
      zipCode: order.shipZipCode,
      city: order.shipCity,
      country: order.shipCountry,
      email: order.clientEmail,
      phone: order.clientPhone,
      siret: order.clientSiret ?? null,
      vatNumber: order.clientVatNumber ?? null,
    },
  });
}
