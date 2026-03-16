import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";

const INVOICE_DIR = path.join(process.cwd(), "private", "uploads", "invoices");

// POST /api/admin/commandes/[id]/invoice — upload facture PDF
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, invoicePath: true } });
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Fichier PDF requis." }, { status: 400 });
  }

  // Ensure directory exists
  await fs.mkdir(INVOICE_DIR, { recursive: true });

  // Delete old invoice if it exists
  if (order.invoicePath) {
    const oldPath = path.join(process.cwd(), "private", "uploads", "invoices", path.basename(order.invoicePath));
    await fs.unlink(oldPath).catch(() => {});
  }

  const filename = `invoice-${id}-${Date.now()}.pdf`;
  const filePath = path.join(INVOICE_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  await prisma.order.update({
    where: { id },
    data: { invoicePath: filename },
  });

  return NextResponse.json({ success: true, filename });
}

// DELETE /api/admin/commandes/[id]/invoice — supprimer facture
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, invoicePath: true } });
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });

  if (order.invoicePath) {
    const filePath = path.join(INVOICE_DIR, path.basename(order.invoicePath));
    await fs.unlink(filePath).catch(() => {});
    await prisma.order.update({ where: { id }, data: { invoicePath: null } });
  }

  return NextResponse.json({ success: true });
}

// GET /api/admin/commandes/[id]/invoice — télécharger facture (admin)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, invoicePath: true, orderNumber: true },
  });
  if (!order?.invoicePath) return NextResponse.json({ error: "Aucune facture." }, { status: 404 });

  const filePath = path.join(INVOICE_DIR, path.basename(order.invoicePath));
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
