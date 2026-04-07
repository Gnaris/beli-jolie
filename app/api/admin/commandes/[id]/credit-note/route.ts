import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";

const CREDIT_NOTE_DIR = path.join(process.cwd(), "private", "uploads", "credit-notes");

// POST /api/admin/commandes/[id]/credit-note — upload avoir PDF
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, creditNotePath: true } });
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Fichier PDF requis." }, { status: 400 });
  }

  await fs.mkdir(CREDIT_NOTE_DIR, { recursive: true });

  // Delete old credit note if it exists
  if (order.creditNotePath) {
    const oldPath = path.join(CREDIT_NOTE_DIR, path.basename(order.creditNotePath));
    await fs.unlink(oldPath).catch(() => {});
  }

  const filename = `credit-note-${id}-${Date.now()}.pdf`;
  const filePath = path.join(CREDIT_NOTE_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  await prisma.order.update({
    where: { id },
    data: { creditNotePath: filename },
  });

  return NextResponse.json({ success: true, filename });
}

// DELETE /api/admin/commandes/[id]/credit-note — supprimer avoir
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, creditNotePath: true } });
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });

  if (order.creditNotePath) {
    const filePath = path.join(CREDIT_NOTE_DIR, path.basename(order.creditNotePath));
    await fs.unlink(filePath).catch(() => {});
    await prisma.order.update({ where: { id }, data: { creditNotePath: null } });
  }

  return NextResponse.json({ success: true });
}

// GET /api/admin/commandes/[id]/credit-note — télécharger avoir (admin)
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
    select: { id: true, creditNotePath: true, orderNumber: true },
  });
  if (!order?.creditNotePath) return NextResponse.json({ error: "Aucun avoir." }, { status: 404 });

  const filePath = path.join(CREDIT_NOTE_DIR, path.basename(order.creditNotePath));
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
