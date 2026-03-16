import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";

// GET /api/client/commandes/[id]/invoice — télécharger la facture (client, uniquement si uploadée)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { id } = await params;

  // The order must belong to the requesting user
  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, invoicePath: true, orderNumber: true },
  });

  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  if (!order.invoicePath) return NextResponse.json({ error: "Aucune facture disponible." }, { status: 404 });

  const filePath = path.join(
    process.cwd(),
    "private",
    "uploads",
    "invoices",
    path.basename(order.invoicePath)
  );

  try {
    await fs.access(filePath);
  } catch {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  const buffer = await fs.readFile(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="facture-${order.orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
