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
  name: string;
  labels?: Record<string, string>;
}

interface ColorInput {
  pfsName: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  labels?: Record<string, string>;
}

interface CompositionInput {
  pfsName: string;
  name: string;
  labels?: Record<string, string>;
}

interface RequestBody {
  categories?: CategoryInput[];
  colors?: ColorInput[];
  compositions?: CompositionInput[];
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

    let createdCategories = 0;
    let createdColors = 0;
    let createdCompositions = 0;
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
              },
            });
            createdCategories++;
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
              },
            });
            createdColors++;
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
              },
            });
            createdCompositions++;
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

    // ── Revalidate caches ───────────────────────
    if (createdCategories > 0) revalidateTag("categories", "default");
    if (createdColors > 0) revalidateTag("colors", "default");
    if (createdCompositions > 0) revalidateTag("compositions", "default");

    return NextResponse.json({
      created: {
        categories: createdCategories,
        colors: createdColors,
        compositions: createdCompositions,
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
