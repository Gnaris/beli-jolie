import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";

// GET /api/client/commandes/[id]/credit-note — télécharger l'avoir (client)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, creditNotePath: true, orderNumber: true },
  });

  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });
  if (!order.creditNotePath) return NextResponse.json({ error: "Aucun avoir disponible." }, { status: 404 });

  const filePath = path.join(
    process.cwd(),
    "private",
    "uploads",
    "credit-notes",
    path.basename(order.creditNotePath)
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
      "Content-Disposition": `attachment; filename="avoir-${order.orderNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
