import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs/promises";
import { invoiceDir, slugify } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";

// Legacy : ancien dossier plat (lecture pour les factures déjà uploadées
// avant le passage à la nouvelle arbo). N'est plus utilisé pour écrire.
const LEGACY_INVOICE_DIR = path.join(process.cwd(), "private", "uploads", "invoices");

/** Convertit un key BDD ("private/uploads/factures/2026/...") en chemin absolu. */
function absoluteFromKey(key: string): string {
  const cwd = process.cwd();
  if (key.startsWith("private/")) {
    return path.join(cwd, key);
  }
  // Ancien stockage : juste le nom de fichier dans LEGACY_INVOICE_DIR
  return path.join(LEGACY_INVOICE_DIR, path.basename(key));
}

// POST /api/admin/commandes/[id]/invoice — upload facture PDF
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const tenant = await requireCurrentTenant();

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, invoicePath: true, orderNumber: true, createdAt: true },
  });
  if (!order) return NextResponse.json({ error: "Commande introuvable." }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Fichier PDF requis." }, { status: 400 });
  }

  // Delete old invoice if it exists (lecture compatible legacy + nouvelle arbo).
  if (order.invoicePath) {
    const oldAbs = absoluteFromKey(order.invoicePath);
    await fs.unlink(oldAbs).catch(() => {});
  }

  // Nouvelle arbo : private/uploads/factures/{annee}/commande-{ref}.pdf
  const year = (order.createdAt ?? new Date()).getFullYear();
  const dir = invoiceDir(year, tenant.slug);
  const orderRefSlug = slugify(order.orderNumber);
  const filename = `commande-${orderRefSlug}.pdf`;
  const key = `${dir}/${filename}`;
  const filePath = path.join(process.cwd(), key);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  await prisma.order.update({
    where: { id },
    data: { invoicePath: key },
  });

  return NextResponse.json({ success: true, filename: key });
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
    const filePath = absoluteFromKey(order.invoicePath);
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

  const filePath = absoluteFromKey(order.invoicePath);
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
