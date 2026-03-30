/**
 * POST /api/admin/products/import/draft/[id]/fix
 *
 * Auto-fix an error in a draft row by creating missing entities.
 *
 * body: {
 *   action: "create_category" | "create_color" | "create_subcategory" | "create_composition" | "search_products"
 *   categoryName?: string
 *   colorName?: string
 *   colorHex?: string (default #9CA3AF)
 *   subcategoryName?: string
 *   compositionName?: string
 *   query?: string (for search_products)
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft || draft.adminId !== session.user.id) {
    return NextResponse.json({ error: "Brouillon introuvable" }, { status: 404 });
  }

  const body: {
    action: string;
    categoryName?: string;
    colorName?: string;
    colorHex?: string;
    colorPatternImage?: string;
    subcategoryName?: string;
    parentCategoryId?: string;
    compositionName?: string;
    query?: string;
  } = await req.json();

  try {
    if (body.action === "create_category") {
      const name = body.categoryName?.trim();
      if (!name) return NextResponse.json({ error: "Nom de catégorie requis." }, { status: 400 });

      const existing = await prisma.category.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const category = await prisma.category.create({ data: { name, slug } });
      return NextResponse.json({ ok: true, entity: category });
    }

    if (body.action === "create_color") {
      const name = body.colorName?.trim();
      const patternImage = body.colorPatternImage?.trim() || null;
      const hex = patternImage ? null : (body.colorHex?.trim() || "#9CA3AF");
      if (!name) return NextResponse.json({ error: "Nom de couleur requis." }, { status: 400 });

      const existing = await prisma.color.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const color = await prisma.color.create({ data: { name, hex, patternImage } });
      return NextResponse.json({ ok: true, entity: color });
    }

    if (body.action === "list_colors") {
      const colors = await prisma.color.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, hex: true, patternImage: true },
      });
      return NextResponse.json({ ok: true, colors });
    }

    if (body.action === "create_subcategory") {
      const name = body.subcategoryName?.trim();
      if (!name) return NextResponse.json({ error: "Nom de sous-catégorie requis." }, { status: 400 });

      const existing = await prisma.subCategory.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      // categoryId is required — use provided or first available
      let categoryId = body.parentCategoryId;
      if (!categoryId) {
        const firstCat = await prisma.category.findFirst();
        categoryId = firstCat?.id;
      }
      if (!categoryId) return NextResponse.json({ error: "Aucune catégorie disponible." }, { status: 400 });

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const subCategory = await prisma.subCategory.create({
        data: { name, slug, categoryId },
      });
      return NextResponse.json({ ok: true, entity: subCategory });
    }

    if (body.action === "create_composition") {
      const name = body.compositionName?.trim();
      if (!name) return NextResponse.json({ error: "Nom de composition requis." }, { status: 400 });

      const existing = await prisma.composition.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const composition = await prisma.composition.create({ data: { name } });
      return NextResponse.json({ ok: true, entity: composition });
    }

    if (body.action === "search_products") {
      const query = body.query?.trim();
      if (!query) return NextResponse.json({ error: "Terme de recherche requis." }, { status: 400 });

      const products = await prisma.product.findMany({
        where: {
          OR: [
            { reference: { contains: query } },
            { name: { contains: query } },
          ],
        },
        select: {
          id: true,
          reference: true,
          name: true,
          colors: {
            include: {
              color: true,
              subColors: { orderBy: { position: "asc" }, include: { color: true } },
            },
          },
        },
        take: 20,
      });

      return NextResponse.json({
        ok: true,
        products: products.map((p) => {
          // Group by color composition (groupKey) to avoid showing UNIT + PACK duplicates
          const grouped = new Map<string, { id: string; name: string; hex: string; patternImage: string | null; subColors: { hex: string; patternImage: string | null }[] }>();
          for (const pc of p.colors) {
            if (!pc.colorId || !pc.color) continue;
            const subNames = pc.subColors.map((sc) => sc.color.name);
            const groupKey = subNames.length > 0
              ? `${pc.colorId}::${subNames.join(",")}`
              : pc.colorId;
            if (!grouped.has(groupKey)) {
              const fullName = subNames.length > 0
                ? [pc.color.name, ...subNames].join("/")
                : pc.color.name;
              grouped.set(groupKey, {
                id: pc.id,
                name: fullName,
                hex: pc.color.hex ?? "#9CA3AF",
                patternImage: pc.color.patternImage ?? null,
                subColors: pc.subColors.map((sc) => ({
                  hex: sc.color.hex ?? "#9CA3AF",
                  patternImage: sc.color.patternImage ?? null,
                })),
              });
            }
          }
          return {
            id: p.id,
            reference: p.reference,
            name: p.name,
            colors: [...grouped.values()],
          };
        }),
      });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (err) {
    logger.error("[draft/fix]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
