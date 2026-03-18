import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VALID_LOCALES } from "@/i18n/locales";

/**
 * GET /api/translations/entities?locale=en
 *
 * Returns a flat map { frenchName: translatedName } for every entity type
 * (categories, subcategories, colors, compositions, tags) for the given locale.
 *
 * Falls back to the French name if no translation is found.
 * Used by useProductTranslation hook on the client side.
 */
export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get("locale") ?? "fr";

  if (!VALID_LOCALES.includes(locale as (typeof VALID_LOCALES)[number])) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  // If locale is French, return empty map (no translation needed)
  if (locale === "fr") {
    return NextResponse.json({});
  }

  const [
    categories,
    subCategories,
    colors,
    compositions,
    tags,
  ] = await Promise.all([
    prisma.category.findMany({
      select: {
        name: true,
        translations: { where: { locale }, select: { name: true }, take: 1 },
      },
    }),
    prisma.subCategory.findMany({
      select: {
        name: true,
        translations: { where: { locale }, select: { name: true }, take: 1 },
      },
    }),
    prisma.color.findMany({
      select: {
        name: true,
        translations: { where: { locale }, select: { name: true }, take: 1 },
      },
    }),
    prisma.composition.findMany({
      select: {
        name: true,
        translations: { where: { locale }, select: { name: true }, take: 1 },
      },
    }),
    prisma.tag.findMany({
      select: {
        name: true,
        translations: { where: { locale }, select: { name: true }, take: 1 },
      },
    }),
  ]);

  const map: Record<string, string> = {};

  for (const entity of [...categories, ...subCategories, ...colors, ...compositions, ...tags]) {
    const translated = entity.translations[0]?.name;
    if (translated) {
      map[entity.name.toLowerCase()] = translated;
    }
  }

  return NextResponse.json(map);
}
