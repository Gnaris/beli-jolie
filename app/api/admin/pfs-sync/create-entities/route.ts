import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// POST — Create missing entities from PFS analyze
// ─────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface CategoryInput {
  pfsName: string;
  pfsCategoryId?: string;
  pfsGender?: string;
  pfsFamilyId?: string;
  bjEntityId?: string; // link to existing BJ entity (skip creation)
  name?: string;
  labels?: Record<string, string>;
}

interface ColorInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string; // link to existing BJ entity (skip creation)
  name?: string;
  hex?: string | null;
  patternImage?: string | null;
  labels?: Record<string, string>;
}

interface CompositionInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string; // link to existing BJ entity (skip creation)
  name?: string;
  labels?: Record<string, string>;
}

interface CountryInput {
  pfsName: string;
  pfsReference?: string; // ISO code
  bjEntityId?: string; // link to existing BJ entity (skip creation)
  name?: string;
  isoCode?: string;
  labels?: Record<string, string>;
}

interface SeasonInput {
  pfsName: string;
  pfsReference?: string; // e.g. PE2026
  bjEntityId?: string; // link to existing BJ entity (skip creation)
  name?: string;
  labels?: Record<string, string>;
}

interface SizeInput {
  name: string; // TU, S, M, XL…
  bjCategoryIds?: string[]; // BJ category IDs to link via SizeCategoryLink (user-selected)
  pfsSizeRefs?: string[]; // PFS size refs to map via SizePfsMapping
}

interface RequestBody {
  categories?: CategoryInput[];
  colors?: ColorInput[];
  compositions?: CompositionInput[];
  countries?: CountryInput[];
  seasons?: SeasonInput[];
  sizes?: SizeInput[];
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body: RequestBody = await req.json();
    const categories = body.categories ?? [];
    const colors = body.colors ?? [];
    const compositions = body.compositions ?? [];
    const countries = body.countries ?? [];
    const seasons = body.seasons ?? [];
    const sizes = body.sizes ?? [];

    // ── Pre-check PFS ref uniqueness (only for create mode — link mode may reuse existing refs) ──
    for (const col of colors) {
      if (!col.pfsReference || col.bjEntityId) continue; // skip link mode
      const conflict = await prisma.color.findFirst({
        where: { pfsColorRef: col.pfsReference },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `La référence PFS couleur « ${col.pfsReference} » est déjà utilisée par « ${conflict.name} ».` },
          { status: 409 },
        );
      }
    }
    for (const cat of categories) {
      if (!cat.pfsCategoryId || cat.bjEntityId) continue; // skip link mode
      const conflict = await prisma.category.findFirst({
        where: { pfsCategoryId: cat.pfsCategoryId },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `L'ID PFS catégorie « ${cat.pfsCategoryId} » est déjà utilisé par « ${conflict.name} ».` },
          { status: 409 },
        );
      }
    }
    for (const comp of compositions) {
      if (!comp.pfsReference || comp.bjEntityId) continue; // skip link mode
      const conflict = await prisma.composition.findFirst({
        where: { pfsCompositionRef: comp.pfsReference },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `La référence PFS composition « ${comp.pfsReference} » est déjà utilisée par « ${conflict.name} ».` },
          { status: 409 },
        );
      }
    }

    for (const country of countries) {
      if (!country.pfsReference || country.bjEntityId) continue; // skip link mode
      const conflict = await prisma.manufacturingCountry.findFirst({
        where: { pfsCountryRef: country.pfsReference },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `La référence PFS pays « ${country.pfsReference} » est déjà utilisée par « ${conflict.name} ».` },
          { status: 409 },
        );
      }
    }
    for (const season of seasons) {
      if (!season.pfsReference || season.bjEntityId) continue; // skip link mode
      const conflict = await prisma.season.findFirst({
        where: { pfsRef: season.pfsReference.trim().toUpperCase() },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `La référence PFS saison « ${season.pfsReference} » est déjà utilisée par « ${conflict.name} ».` },
          { status: 409 },
        );
      }
    }

    let createdCategories = 0;
    let createdColors = 0;
    let createdCompositions = 0;
    let createdCountries = 0;
    let createdSeasons = 0;
    let createdSizes = 0;
    let mappingsCount = 0;

    // ── Categories ──────────────────────────────
    for (const cat of categories) {
      try {
        // ── LINK MODE: link PFS name to existing BJ entity ──
        if (cat.bjEntityId) {
          const entity = await prisma.category.findUnique({
            where: { id: cat.bjEntityId },
            select: { id: true, name: true, pfsCategoryId: true },
          });
          if (!entity) {
            return NextResponse.json({ error: `Catégorie BJ introuvable: ${cat.bjEntityId}` }, { status: 404 });
          }
          // Update PFS ref fields if not set
          if (cat.pfsCategoryId && !entity.pfsCategoryId) {
            await prisma.category.update({
              where: { id: entity.id },
              data: { pfsCategoryId: cat.pfsCategoryId, pfsGender: cat.pfsGender || null, pfsFamilyId: cat.pfsFamilyId || null },
            });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "category", pfsName: cat.pfsName.toLowerCase() } },
            create: { type: "category", pfsName: cat.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
          mappingsCount++;
          continue;
        }

        // ── CREATE MODE: create new BJ entity ──
        if (!cat.name) {
          logger.error(`[PFS] Category missing name and bjEntityId: ${cat.pfsName}`);
          continue;
        }
        const entity = await prisma.$transaction(async (tx) => {
          // Try to create, fall back to findFirst if unique constraint fails
          let existing = await tx.category.findFirst({
            where: { name: cat.name },
          });

          if (!existing) {
            existing = await tx.category.create({
              data: {
                name: cat.name!,
                slug: slugify(cat.name!),
                pfsCategoryId: cat.pfsCategoryId || null,
                pfsGender: cat.pfsGender || null,
                pfsFamilyId: cat.pfsFamilyId || null,
              },
            });
            createdCategories++;
          } else if (cat.pfsCategoryId && !existing.pfsCategoryId) {
            existing = await tx.category.update({
              where: { id: existing.id },
              data: {
                pfsCategoryId: cat.pfsCategoryId,
                pfsGender: cat.pfsGender || null,
                pfsFamilyId: cat.pfsFamilyId || null,
              },
            });
          }

          // Create translations
          if (cat.labels) {
            for (const [locale, name] of Object.entries(cat.labels)) {
              if (!name || locale === "fr") continue;
              await tx.categoryTranslation.upsert({
                where: { categoryId_locale: { categoryId: existing.id, locale } },
                create: { categoryId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "category", pfsName: cat.pfsName.toLowerCase() } },
          create: { type: "category", pfsName: cat.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: cat.name! },
          update: { bjEntityId: entity.id, bjName: cat.name! },
        });
        mappingsCount++;
      } catch (err) {
        if (cat.name) {
          const existing = await prisma.category.findFirst({ where: { name: cat.name } });
          if (existing) {
            await prisma.pfsMapping.upsert({
              where: { type_pfsName: { type: "category", pfsName: cat.pfsName.toLowerCase() } },
              create: { type: "category", pfsName: cat.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: cat.name },
              update: { bjEntityId: existing.id, bjName: cat.name },
            });
            mappingsCount++;
          } else {
            logger.error(`[PFS] Failed to create category "${cat.name}"`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // ── Colors ──────────────────────────────────
    for (const col of colors) {
      try {
        // ── LINK MODE ──
        if (col.bjEntityId) {
          const entity = await prisma.color.findUnique({
            where: { id: col.bjEntityId },
            select: { id: true, name: true, pfsColorRef: true },
          });
          if (!entity) {
            return NextResponse.json({ error: `Couleur BJ introuvable: ${col.bjEntityId}` }, { status: 404 });
          }
          if (col.pfsReference && !entity.pfsColorRef) {
            await prisma.color.update({ where: { id: entity.id }, data: { pfsColorRef: col.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "color", pfsName: col.pfsName.toLowerCase() } },
            create: { type: "color", pfsName: col.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
          mappingsCount++;
          continue;
        }

        // ── CREATE MODE ──
        if (!col.name) {
          logger.error(`[PFS] Color missing name and bjEntityId: ${col.pfsName}`);
          continue;
        }
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.color.findFirst({ where: { name: col.name } });

          if (!existing) {
            existing = await tx.color.create({
              data: {
                name: col.name!,
                hex: col.hex ?? null,
                patternImage: col.patternImage ?? null,
                pfsColorRef: col.pfsReference || null,
              },
            });
            createdColors++;
          } else if (col.pfsReference && !existing.pfsColorRef) {
            existing = await tx.color.update({ where: { id: existing.id }, data: { pfsColorRef: col.pfsReference } });
          }

          if (col.labels) {
            for (const [locale, name] of Object.entries(col.labels)) {
              if (!name || locale === "fr") continue;
              await tx.colorTranslation.upsert({
                where: { colorId_locale: { colorId: existing.id, locale } },
                create: { colorId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "color", pfsName: col.pfsName.toLowerCase() } },
          create: { type: "color", pfsName: col.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: col.name! },
          update: { bjEntityId: entity.id, bjName: col.name! },
        });
        mappingsCount++;
      } catch (err) {
        if (col.name) {
          const existing = await prisma.color.findFirst({ where: { name: col.name } });
          if (existing) {
            await prisma.pfsMapping.upsert({
              where: { type_pfsName: { type: "color", pfsName: col.pfsName.toLowerCase() } },
              create: { type: "color", pfsName: col.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: col.name },
              update: { bjEntityId: existing.id, bjName: col.name },
            });
            mappingsCount++;
          } else {
            logger.error(`[PFS] Failed to create color "${col.name}"`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // ── Compositions ────────────────────────────
    for (const comp of compositions) {
      try {
        // ── LINK MODE ──
        if (comp.bjEntityId) {
          const entity = await prisma.composition.findUnique({
            where: { id: comp.bjEntityId },
            select: { id: true, name: true, pfsCompositionRef: true },
          });
          if (!entity) {
            return NextResponse.json({ error: `Composition BJ introuvable: ${comp.bjEntityId}` }, { status: 404 });
          }
          if (comp.pfsReference && !entity.pfsCompositionRef) {
            await prisma.composition.update({ where: { id: entity.id }, data: { pfsCompositionRef: comp.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "composition", pfsName: comp.pfsName.toLowerCase() } },
            create: { type: "composition", pfsName: comp.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
          mappingsCount++;
          continue;
        }

        // ── CREATE MODE ──
        if (!comp.name) {
          logger.error(`[PFS] Composition missing name and bjEntityId: ${comp.pfsName}`);
          continue;
        }
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.composition.findFirst({ where: { name: comp.name } });

          if (!existing) {
            existing = await tx.composition.create({
              data: { name: comp.name!, pfsCompositionRef: comp.pfsReference || null },
            });
            createdCompositions++;
          } else if (comp.pfsReference && !existing.pfsCompositionRef) {
            existing = await tx.composition.update({ where: { id: existing.id }, data: { pfsCompositionRef: comp.pfsReference } });
          }

          if (comp.labels) {
            for (const [locale, name] of Object.entries(comp.labels)) {
              if (!name || locale === "fr") continue;
              await tx.compositionTranslation.upsert({
                where: { compositionId_locale: { compositionId: existing.id, locale } },
                create: { compositionId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "composition", pfsName: comp.pfsName.toLowerCase() } },
          create: { type: "composition", pfsName: comp.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: comp.name! },
          update: { bjEntityId: entity.id, bjName: comp.name! },
        });
        mappingsCount++;
      } catch (err) {
        if (comp.name) {
          const existing = await prisma.composition.findFirst({ where: { name: comp.name } });
          if (existing) {
            await prisma.pfsMapping.upsert({
              where: { type_pfsName: { type: "composition", pfsName: comp.pfsName.toLowerCase() } },
              create: { type: "composition", pfsName: comp.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: comp.name },
              update: { bjEntityId: existing.id, bjName: comp.name },
            });
            mappingsCount++;
          } else {
            logger.error(`[PFS] Failed to create composition "${comp.name}"`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // ── Countries ─────────────────────────────────
    for (const country of countries) {
      try {
        // ── LINK MODE ──
        if (country.bjEntityId) {
          const entity = await prisma.manufacturingCountry.findUnique({
            where: { id: country.bjEntityId },
            select: { id: true, name: true, pfsCountryRef: true },
          });
          if (!entity) {
            return NextResponse.json({ error: `Pays BJ introuvable: ${country.bjEntityId}` }, { status: 404 });
          }
          if (country.pfsReference && !entity.pfsCountryRef) {
            await prisma.manufacturingCountry.update({ where: { id: entity.id }, data: { pfsCountryRef: country.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
            create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
          mappingsCount++;
          continue;
        }

        // ── CREATE MODE ──
        if (!country.name) {
          logger.error(`[PFS] Country missing name and bjEntityId: ${country.pfsName}`);
          continue;
        }
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.manufacturingCountry.findFirst({ where: { name: country.name } });

          if (!existing) {
            existing = await tx.manufacturingCountry.create({
              data: { name: country.name!, isoCode: country.isoCode || country.pfsReference || null, pfsCountryRef: country.pfsReference || null },
            });
            createdCountries++;
          } else if (country.pfsReference && !existing.pfsCountryRef) {
            existing = await tx.manufacturingCountry.update({ where: { id: existing.id }, data: { pfsCountryRef: country.pfsReference } });
          }

          if (country.labels) {
            for (const [locale, name] of Object.entries(country.labels)) {
              if (!name || locale === "fr") continue;
              await tx.manufacturingCountryTranslation.upsert({
                where: { manufacturingCountryId_locale: { manufacturingCountryId: existing.id, locale } },
                create: { manufacturingCountryId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
          create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: country.name! },
          update: { bjEntityId: entity.id, bjName: country.name! },
        });
        mappingsCount++;
      } catch (err) {
        if (country.name) {
          const existing = await prisma.manufacturingCountry.findFirst({ where: { name: country.name } });
          if (existing) {
            await prisma.pfsMapping.upsert({
              where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
              create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: country.name },
              update: { bjEntityId: existing.id, bjName: country.name },
            });
            mappingsCount++;
          } else {
            logger.error(`[PFS] Failed to create country "${country.name}"`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // ── Seasons ──────────────────────────────────
    for (const season of seasons) {
      try {
        // ── LINK MODE ──
        if (season.bjEntityId) {
          const entity = await prisma.season.findUnique({
            where: { id: season.bjEntityId },
            select: { id: true, name: true, pfsRef: true },
          });
          if (!entity) {
            return NextResponse.json({ error: `Saison BJ introuvable: ${season.bjEntityId}` }, { status: 404 });
          }
          // Set pfsRef if not already set
          if (season.pfsReference && !entity.pfsRef) {
            await prisma.season.update({ where: { id: entity.id }, data: { pfsRef: season.pfsReference.trim().toUpperCase() } }).catch(() => {});
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
            create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
          mappingsCount++;
          continue;
        }

        // ── CREATE MODE ──
        if (!season.name) {
          logger.error(`[PFS] Season missing name and bjEntityId: ${season.pfsName}`);
          continue;
        }
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.season.findFirst({
            where: { name: season.name },
          });

          if (!existing) {
            existing = await tx.season.create({
              data: {
                name: season.name!,
                pfsRef: season.pfsReference ? season.pfsReference.trim().toUpperCase() : null,
              },
            });
            createdSeasons++;
          } else if (season.pfsReference && !existing.pfsRef) {
            existing = await tx.season.update({ where: { id: existing.id }, data: { pfsRef: season.pfsReference.trim().toUpperCase() } });
          }

          if (season.labels) {
            for (const [locale, name] of Object.entries(season.labels)) {
              if (!name || locale === "fr") continue;
              await tx.seasonTranslation.upsert({
                where: { seasonId_locale: { seasonId: existing.id, locale } },
                create: { seasonId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
          create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: season.name! },
          update: { bjEntityId: entity.id, bjName: season.name! },
        });
        mappingsCount++;
      } catch (err) {
        if (season.name) {
          const existing = await prisma.season.findFirst({ where: { name: season.name } });
          if (existing) {
            await prisma.pfsMapping.upsert({
              where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
              create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: season.name },
              update: { bjEntityId: existing.id, bjName: season.name },
            });
            mappingsCount++;
          } else {
            logger.error(`[PFS] Failed to create season "${season.name}"`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // ── Sizes ─────────────────────────────────────
    // Get current max position to append new sizes after
    const maxPositionRow = await prisma.size.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });
    let nextPosition = (maxPositionRow?.position ?? -1) + 1;

    for (const sz of sizes) {
      if (!sz.name?.trim()) continue;
      try {
        let sizeRecord = await prisma.size.findFirst({ where: { name: sz.name } });
        if (!sizeRecord) {
          sizeRecord = await prisma.size.create({ data: { name: sz.name, position: nextPosition++ } });
          createdSizes++;
        }
        // Link to categories via SizeCategoryLink (idempotent upsert)
        if (sizeRecord && sz.bjCategoryIds?.length) {
          for (const bjCatId of sz.bjCategoryIds) {
            await prisma.sizeCategoryLink.upsert({
              where: { sizeId_categoryId: { sizeId: sizeRecord.id, categoryId: bjCatId } },
              create: { sizeId: sizeRecord.id, categoryId: bjCatId },
              update: {},
            });
          }
        }
        // Link to PFS size refs via SizePfsMapping (idempotent upsert)
        if (sizeRecord && sz.pfsSizeRefs?.length) {
          for (const pfsRef of sz.pfsSizeRefs) {
            if (!pfsRef.trim()) continue;
            await prisma.sizePfsMapping.upsert({
              where: { sizeId_pfsSizeRef: { sizeId: sizeRecord.id, pfsSizeRef: pfsRef.trim() } },
              create: { sizeId: sizeRecord.id, pfsSizeRef: pfsRef.trim() },
              update: {},
            });
          }
        }
      } catch (err) {
        logger.error(`[PFS] Failed to create size "${sz.name}"`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Revalidate caches ───────────────────────
    if (createdCategories > 0) revalidateTag("categories", "default");
    if (createdColors > 0) revalidateTag("colors", "default");
    if (createdCompositions > 0) revalidateTag("compositions", "default");
    if (createdCountries > 0) revalidateTag("manufacturing-countries", "default");
    if (createdSeasons > 0) revalidateTag("seasons", "default");
    if (createdSizes > 0) revalidateTag("sizes", "default");

    return NextResponse.json({
      created: {
        categories: createdCategories,
        colors: createdColors,
        compositions: createdCompositions,
        countries: createdCountries,
        seasons: createdSeasons,
        sizes: createdSizes,
      },
      mappings: mappingsCount,
    });
  } catch (err) {
    logger.error("[PFS] create-entities error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Erreur lors de la création des entités" },
      { status: 500 },
    );
  }
}
