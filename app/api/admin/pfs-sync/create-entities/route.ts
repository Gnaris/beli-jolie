import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

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
  name: string;
  labels?: Record<string, string>;
}

interface ColorInput {
  pfsName: string;
  pfsReference?: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  labels?: Record<string, string>;
}

interface CompositionInput {
  pfsName: string;
  pfsReference?: string;
  name: string;
  labels?: Record<string, string>;
}

interface CountryInput {
  pfsName: string;
  pfsReference?: string; // ISO code
  name: string;
  isoCode?: string;
  labels?: Record<string, string>;
}

interface SeasonInput {
  pfsName: string;
  pfsReference?: string; // e.g. PE2026
  name: string;
  labels?: Record<string, string>;
}

interface RequestBody {
  categories?: CategoryInput[];
  colors?: ColorInput[];
  compositions?: CompositionInput[];
  countries?: CountryInput[];
  seasons?: SeasonInput[];
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

    // ── Pre-check PFS ref uniqueness ──────────────
    for (const col of colors) {
      if (!col.pfsReference) continue;
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
      if (!cat.pfsCategoryId) continue;
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
      if (!comp.pfsReference) continue;
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
      if (!country.pfsReference) continue;
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
      if (!season.pfsReference) continue;
      const conflict = await prisma.season.findFirst({
        where: { pfsSeasonRef: season.pfsReference },
        select: { id: true, name: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `La référence PFS saison « ${season.pfsReference} » est déjà utilisée par « ${season.name} ».` },
          { status: 409 },
        );
      }
    }

    let createdCategories = 0;
    let createdColors = 0;
    let createdCompositions = 0;
    let createdCountries = 0;
    let createdSeasons = 0;
    let mappingsCount = 0;

    // ── Categories ──────────────────────────────
    for (const cat of categories) {
      try {
        const entity = await prisma.$transaction(async (tx) => {
          // Try to create, fall back to findFirst if unique constraint fails
          let existing = await tx.category.findFirst({
            where: { name: cat.name },
          });

          if (!existing) {
            existing = await tx.category.create({
              data: {
                name: cat.name,
                slug: slugify(cat.name),
                pfsCategoryId: cat.pfsCategoryId || null,
                pfsGender: cat.pfsGender || null,
                pfsFamilyId: cat.pfsFamilyId || null,
              },
            });
            createdCategories++;
          } else if (cat.pfsCategoryId && !existing.pfsCategoryId) {
            // Entity existed but had no PFS mapping — fill it in
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
                where: {
                  categoryId_locale: {
                    categoryId: existing.id,
                    locale,
                  },
                },
                create: {
                  categoryId: existing.id,
                  locale,
                  name,
                },
                update: { name },
              });
            }
          }

          return existing;
        });

        // Upsert PfsMapping outside transaction for resilience
        await prisma.pfsMapping.upsert({
          where: {
            type_pfsName: {
              type: "category",
              pfsName: cat.pfsName.toLowerCase(),
            },
          },
          create: {
            type: "category",
            pfsName: cat.pfsName.toLowerCase(),
            bjEntityId: entity.id,
            bjName: cat.name,
          },
          update: {
            bjEntityId: entity.id,
            bjName: cat.name,
          },
        });
        mappingsCount++;
      } catch (err) {
        // Race condition: entity may have been created concurrently
        const existing = await prisma.category.findFirst({
          where: { name: cat.name },
        });
        if (existing) {
          await prisma.pfsMapping.upsert({
            where: {
              type_pfsName: {
                type: "category",
                pfsName: cat.pfsName.toLowerCase(),
              },
            },
            create: {
              type: "category",
              pfsName: cat.pfsName.toLowerCase(),
              bjEntityId: existing.id,
              bjName: cat.name,
            },
            update: {
              bjEntityId: existing.id,
              bjName: cat.name,
            },
          });
          mappingsCount++;
        } else {
          console.error(`[PFS] Failed to create category "${cat.name}":`, err);
        }
      }
    }

    // ── Colors ──────────────────────────────────
    for (const col of colors) {
      try {
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.color.findFirst({
            where: { name: col.name },
          });

          if (!existing) {
            existing = await tx.color.create({
              data: {
                name: col.name,
                hex: col.hex,
                patternImage: col.patternImage,
                pfsColorRef: col.pfsReference || null,
              },
            });
            createdColors++;
          } else if (col.pfsReference && !existing.pfsColorRef) {
            existing = await tx.color.update({
              where: { id: existing.id },
              data: { pfsColorRef: col.pfsReference },
            });
          }

          // Create translations
          if (col.labels) {
            for (const [locale, name] of Object.entries(col.labels)) {
              if (!name || locale === "fr") continue;
              await tx.colorTranslation.upsert({
                where: {
                  colorId_locale: {
                    colorId: existing.id,
                    locale,
                  },
                },
                create: {
                  colorId: existing.id,
                  locale,
                  name,
                },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: {
            type_pfsName: {
              type: "color",
              pfsName: col.pfsName.toLowerCase(),
            },
          },
          create: {
            type: "color",
            pfsName: col.pfsName.toLowerCase(),
            bjEntityId: entity.id,
            bjName: col.name,
          },
          update: {
            bjEntityId: entity.id,
            bjName: col.name,
          },
        });
        mappingsCount++;
      } catch (err) {
        const existing = await prisma.color.findFirst({
          where: { name: col.name },
        });
        if (existing) {
          await prisma.pfsMapping.upsert({
            where: {
              type_pfsName: {
                type: "color",
                pfsName: col.pfsName.toLowerCase(),
              },
            },
            create: {
              type: "color",
              pfsName: col.pfsName.toLowerCase(),
              bjEntityId: existing.id,
              bjName: col.name,
            },
            update: {
              bjEntityId: existing.id,
              bjName: col.name,
            },
          });
          mappingsCount++;
        } else {
          console.error(`[PFS] Failed to create color "${col.name}":`, err);
        }
      }
    }

    // ── Compositions ────────────────────────────
    for (const comp of compositions) {
      try {
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.composition.findFirst({
            where: { name: comp.name },
          });

          if (!existing) {
            existing = await tx.composition.create({
              data: {
                name: comp.name,
                pfsCompositionRef: comp.pfsReference || null,
              },
            });
            createdCompositions++;
          } else if (comp.pfsReference && !existing.pfsCompositionRef) {
            existing = await tx.composition.update({
              where: { id: existing.id },
              data: { pfsCompositionRef: comp.pfsReference },
            });
          }

          // Create translations
          if (comp.labels) {
            for (const [locale, name] of Object.entries(comp.labels)) {
              if (!name || locale === "fr") continue;
              await tx.compositionTranslation.upsert({
                where: {
                  compositionId_locale: {
                    compositionId: existing.id,
                    locale,
                  },
                },
                create: {
                  compositionId: existing.id,
                  locale,
                  name,
                },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: {
            type_pfsName: {
              type: "composition",
              pfsName: comp.pfsName.toLowerCase(),
            },
          },
          create: {
            type: "composition",
            pfsName: comp.pfsName.toLowerCase(),
            bjEntityId: entity.id,
            bjName: comp.name,
          },
          update: {
            bjEntityId: entity.id,
            bjName: comp.name,
          },
        });
        mappingsCount++;
      } catch (err) {
        const existing = await prisma.composition.findFirst({
          where: { name: comp.name },
        });
        if (existing) {
          await prisma.pfsMapping.upsert({
            where: {
              type_pfsName: {
                type: "composition",
                pfsName: comp.pfsName.toLowerCase(),
              },
            },
            create: {
              type: "composition",
              pfsName: comp.pfsName.toLowerCase(),
              bjEntityId: existing.id,
              bjName: comp.name,
            },
            update: {
              bjEntityId: existing.id,
              bjName: comp.name,
            },
          });
          mappingsCount++;
        } else {
          console.error(`[PFS] Failed to create composition "${comp.name}":`, err);
        }
      }
    }

    // ── Countries ─────────────────────────────────
    for (const country of countries) {
      try {
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.manufacturingCountry.findFirst({
            where: { name: country.name },
          });

          if (!existing) {
            existing = await tx.manufacturingCountry.create({
              data: {
                name: country.name,
                isoCode: country.isoCode || country.pfsReference || null,
                pfsCountryRef: country.pfsReference || null,
              },
            });
            createdCountries++;
          } else if (country.pfsReference && !existing.pfsCountryRef) {
            existing = await tx.manufacturingCountry.update({
              where: { id: existing.id },
              data: { pfsCountryRef: country.pfsReference },
            });
          }

          if (country.labels) {
            for (const [locale, name] of Object.entries(country.labels)) {
              if (!name || locale === "fr") continue;
              await tx.manufacturingCountryTranslation.upsert({
                where: {
                  manufacturingCountryId_locale: {
                    manufacturingCountryId: existing.id,
                    locale,
                  },
                },
                create: { manufacturingCountryId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
          create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: country.name },
          update: { bjEntityId: entity.id, bjName: country.name },
        });
        mappingsCount++;
      } catch (err) {
        const existing = await prisma.manufacturingCountry.findFirst({ where: { name: country.name } });
        if (existing) {
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
            create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: country.name },
            update: { bjEntityId: existing.id, bjName: country.name },
          });
          mappingsCount++;
        } else {
          console.error(`[PFS] Failed to create country "${country.name}":`, err);
        }
      }
    }

    // ── Seasons ──────────────────────────────────
    for (const season of seasons) {
      try {
        const entity = await prisma.$transaction(async (tx) => {
          let existing = await tx.season.findFirst({
            where: { name: season.name },
          });

          if (!existing) {
            existing = await tx.season.create({
              data: {
                name: season.name,
                pfsSeasonRef: season.pfsReference || null,
              },
            });
            createdSeasons++;
          } else if (season.pfsReference && !existing.pfsSeasonRef) {
            existing = await tx.season.update({
              where: { id: existing.id },
              data: { pfsSeasonRef: season.pfsReference },
            });
          }

          if (season.labels) {
            for (const [locale, name] of Object.entries(season.labels)) {
              if (!name || locale === "fr") continue;
              await tx.seasonTranslation.upsert({
                where: {
                  seasonId_locale: { seasonId: existing.id, locale },
                },
                create: { seasonId: existing.id, locale, name },
                update: { name },
              });
            }
          }

          return existing;
        });

        await prisma.pfsMapping.upsert({
          where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
          create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: season.name },
          update: { bjEntityId: entity.id, bjName: season.name },
        });
        mappingsCount++;
      } catch (err) {
        const existing = await prisma.season.findFirst({ where: { name: season.name } });
        if (existing) {
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
            create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: existing.id, bjName: season.name },
            update: { bjEntityId: existing.id, bjName: season.name },
          });
          mappingsCount++;
        } else {
          console.error(`[PFS] Failed to create season "${season.name}":`, err);
        }
      }
    }

    // ── Revalidate caches ───────────────────────
    if (createdCategories > 0) revalidateTag("categories", "default");
    if (createdColors > 0) revalidateTag("colors", "default");
    if (createdCompositions > 0) revalidateTag("compositions", "default");
    if (createdCountries > 0) revalidateTag("manufacturing-countries", "default");
    if (createdSeasons > 0) revalidateTag("seasons", "default");

    return NextResponse.json({
      created: {
        categories: createdCategories,
        colors: createdColors,
        compositions: createdCompositions,
        countries: createdCountries,
        seasons: createdSeasons,
      },
      mappings: mappingsCount,
    });
  } catch (err) {
    console.error("[PFS] create-entities error:", err);
    return NextResponse.json(
      { error: "Erreur lors de la création des entités" },
      { status: 500 },
    );
  }
}
