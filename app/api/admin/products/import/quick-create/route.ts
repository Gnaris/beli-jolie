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
 *   pfsCategoryId?: string      (for create_category — PFS category ID)
 *   pfsGender?: string          (for create_category — PFS gender)
 *   pfsFamilyId?: string        (for create_category — PFS family ID)
 *   pfsCompositionRef?: string  (for create_composition — PFS composition reference)
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { autoTranslateColor, autoTranslateCategory, autoTranslateSubCategory, autoTranslateComposition, autoTranslateManufacturingCountry, autoTranslateSeason } from "@/lib/auto-translate";

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
    pfsCategoryId?: string;
    pfsGender?: string;
    pfsFamilyId?: string;
    pfsFamilyName?: string;
    pfsCategoryName?: string;
    pfsCompositionRef?: string;
    pfsCountryRef?: string;
    pfsRef?: string; // PFS collection reference for seasons
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
      if (existing) {
        // Update PFS fields if provided and missing on the existing category
        const pfsUpdate: Record<string, string> = {};
        if (body.pfsGender && !existing.pfsGender) pfsUpdate.pfsGender = body.pfsGender;
        if (body.pfsFamilyName && !existing.pfsFamilyName) pfsUpdate.pfsFamilyName = body.pfsFamilyName;
        if (body.pfsCategoryName && !existing.pfsCategoryName) pfsUpdate.pfsCategoryName = body.pfsCategoryName;
        if (body.pfsCategoryId && !existing.pfsCategoryId) pfsUpdate.pfsCategoryId = body.pfsCategoryId;
        if (body.pfsFamilyId && !existing.pfsFamilyId) pfsUpdate.pfsFamilyId = body.pfsFamilyId;
        if (Object.keys(pfsUpdate).length > 0) {
          const updated = await prisma.category.update({ where: { id: existing.id }, data: pfsUpdate });
          revalidateTag("categories", "default");
          return NextResponse.json({ ok: true, entity: updated, already: true });
        }
        return NextResponse.json({ ok: true, entity: existing, already: true });
      }

      const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const category = await prisma.category.create({
        data: {
          name,
          slug,
          ...(body.pfsCategoryId ? { pfsCategoryId: body.pfsCategoryId } : {}),
          ...(body.pfsGender ? { pfsGender: body.pfsGender } : {}),
          ...(body.pfsFamilyId ? { pfsFamilyId: body.pfsFamilyId } : {}),
          ...(body.pfsFamilyName ? { pfsFamilyName: body.pfsFamilyName } : {}),
          ...(body.pfsCategoryName ? { pfsCategoryName: body.pfsCategoryName } : {}),
        },
      });
      revalidateTag("categories", "default");
      // Fire-and-forget auto-translation
      autoTranslateCategory(category.id, name);
      return NextResponse.json({ ok: true, entity: category });
    }

    if (body.action === "create_color") {
      const existing = await prisma.color.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const patternImage = body.patternImage?.trim() || null;
      const hex = patternImage ? null : (body.colorHex?.trim() || "#9CA3AF");
      const color = await prisma.color.create({
        data: {
          name,
          hex,
          patternImage,
        },
      });
      revalidateTag("colors", "default");
      // Fire-and-forget auto-translation
      autoTranslateColor(color.id, name);
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
      // Fire-and-forget auto-translation
      autoTranslateSubCategory(subCategory.id, name);
      return NextResponse.json({ ok: true, entity: subCategory });
    }

    if (body.action === "create_composition") {
      const existing = await prisma.composition.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const composition = await prisma.composition.create({
        data: {
          name,
          ...(body.pfsCompositionRef ? { pfsCompositionRef: body.pfsCompositionRef } : {}),
        },
      });
      revalidateTag("compositions", "default");
      // Fire-and-forget auto-translation
      autoTranslateComposition(composition.id, name);
      return NextResponse.json({ ok: true, entity: composition });
    }

    if (body.action === "create_country") {
      const existing = await prisma.manufacturingCountry.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const country = await prisma.manufacturingCountry.create({
        data: {
          name,
          ...(body.pfsCountryRef ? { pfsCountryRef: body.pfsCountryRef } : {}),
        },
      });
      revalidateTag("manufacturing-countries", "default");
      // Fire-and-forget auto-translation
      autoTranslateManufacturingCountry(country.id, name);
      return NextResponse.json({ ok: true, entity: country });
    }

    if (body.action === "create_season") {
      const existing = await prisma.season.findFirst({ where: { name } });
      if (existing) return NextResponse.json({ ok: true, entity: existing, already: true });

      const season = await prisma.season.create({
        data: {
          name,
          ...(body.pfsRef ? { pfsRef: body.pfsRef } : {}),
        },
      });
      revalidateTag("seasons", "default");
      // Fire-and-forget auto-translation
      autoTranslateSeason(season.id, name);
      return NextResponse.json({ ok: true, entity: season });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (err) {
    logger.error("[import/quick-create]", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur." }, { status: 500 });
  }
}
