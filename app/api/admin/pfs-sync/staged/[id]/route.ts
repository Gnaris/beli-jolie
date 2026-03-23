import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}

// ─────────────────────────────────────────────
// GET — Get a single staged product by id
// ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const product = await prisma.pfsStagedProduct.findUnique({ where: { id } });

  if (!product) {
    return NextResponse.json(
      { error: "Produit stagé introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json({ product });
}

// ─────────────────────────────────────────────
// PATCH — Update editable fields of a staged product
// ─────────────────────────────────────────────

const EDITABLE_FIELDS = [
  "name",
  "description",
  "categoryId",
  "categoryName",
  "subCategoryIds",
  "subCategoryNames",
  "isBestSeller",
  "variants",
  "compositions",
  "translations",
  "imagesByColor",
  "tags",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  // Check the product exists and is in READY status
  const existing = await prisma.pfsStagedProduct.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Produit stagé introuvable" },
      { status: 404 }
    );
  }

  if (existing.status !== "READY") {
    return NextResponse.json(
      {
        error: `Seuls les produits au statut READY peuvent être modifiés (statut actuel : ${existing.status})`,
      },
      { status: 400 }
    );
  }

  const body = await req.json();

  // Build update data from allowed fields only
  const data: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Aucun champ modifiable fourni" },
      { status: 400 }
    );
  }

  const updated = await prisma.pfsStagedProduct.update({
    where: { id },
    data,
  });

  return NextResponse.json({ product: updated });
}
