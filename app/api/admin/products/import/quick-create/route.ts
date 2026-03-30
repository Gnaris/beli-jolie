/**
 * POST /api/admin/products/import/quick-create
 *
 * Create missing entities (category, color, subcategory, composition)
 * directly from the import preview screen — no draft required.
 *
 * body: {
 *   action: "create_category" | "create_color" | "create_subcategory" | "create_composition"
 *   name: string
 *   colorHex?: string           (for create_color, default #9CA3AF)
 *   patternImage?: string       (for create_color — if set, hex is ignored)
 *   parentCategoryId?: string   (for create_subcategory, optional)
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body: {
    action: string;
    name?: string;
    colorHex?: string;
    patternImage?: string;
    parentCategoryId?: string;
    parentCategoryName?: string;
  } = await req.json();

  try {
    // list_colors doesn't need a name
    if (body.action === "list_colors") {
      const colors = await prisma.color.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, hex: true, patternImage: true },
      });
      return NextResponse.json({ ok: true, colors });
    }

    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Nom requis." }, { status: 400 });
    if (body.action === "create_category") {
      const existing = await prisma.category.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const category = await prisma.category.create({ data: { name, slug } });
      revalidateTag("categories", "default");
      return NextResponse.json({ ok: true, entity: category });
    }

    if (body.action === "create_color") {
      const existing = await prisma.color.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const patternImage = body.patternImage?.trim() || null;
      const hex = patternImage ? null : (body.colorHex?.trim() || "#9CA3AF");
      const color = await prisma.color.create({ data: { name, hex, patternImage } });
      revalidateTag("colors", "default");
      return NextResponse.json({ ok: true, entity: color });
    }

    if (body.action === "create_subcategory") {
      // Resolve parent category: by ID, by name, or fallback to first
      let categoryId = body.parentCategoryId;
      if (!categoryId && body.parentCategoryName) {
        const cat = await prisma.category.findFirst({ where: { name: body.parentCategoryName } });
        categoryId = cat?.id;
      }
      if (!categoryId) {
        const firstCat = await prisma.category.findFirst();
        categoryId = firstCat?.id;
      }
      if (!categoryId) return NextResponse.json({ error: "Aucune catégorie disponible." }, { status: 400 });

      // Check if already exists in this specific category
      const existing = await prisma.subCategory.findFirst({ where: { name, categoryId } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const subCategory = await prisma.subCategory.create({ data: { name, slug, categoryId } });
      revalidateTag("categories", "default");
      return NextResponse.json({ ok: true, entity: subCategory });
    }

    if (body.action === "create_composition") {
      const existing = await prisma.composition.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const composition = await prisma.composition.create({ data: { name } });
      revalidateTag("compositions", "default");
      return NextResponse.json({ ok: true, entity: composition });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (err) {
    logger.error("[import/quick-create]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
