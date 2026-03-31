/**
 * POST /api/admin/pfs-sync/prepare/[id]/validate
 *
 * Validates missing entities (creates/links them) then starts the prepare phase.
 * Reuses logic from create-entities endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { runPfsPrepare } from "@/lib/pfs-prepare";
import { logger } from "@/lib/logger";

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
  bjEntityId?: string;
}

interface ColorInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string;
}

interface CompositionInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string;
}

interface CountryInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string;
}

interface SeasonInput {
  pfsName: string;
  pfsReference?: string;
  bjEntityId?: string;
}

interface SizeInput {
  name: string;
  bjCategoryIds?: string[];
  pfsSizeRefs?: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id: jobId } = await params;

  try {
    // Verify job exists and is in NEEDS_VALIDATION status
    const job = await prisma.pfsPrepareJob.findUnique({
      where: { id: jobId },
      select: { status: true, analyzeResult: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job non trouvé" }, { status: 404 });
    }

    if (job.status !== "NEEDS_VALIDATION") {
      return NextResponse.json(
        { error: "Ce job n'est pas en attente de validation" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const categories: CategoryInput[] = body.categories ?? [];
    const colors: ColorInput[] = body.colors ?? [];
    const compositions: CompositionInput[] = body.compositions ?? [];
    const countries: CountryInput[] = body.countries ?? [];
    const seasons: SeasonInput[] = body.seasons ?? [];
    const sizes: SizeInput[] = body.sizes ?? [];

    let createdCategories = 0;
    let createdColors = 0;
    let createdCompositions = 0;
    let createdCountries = 0;
    let createdSeasons = 0;
    let createdSizes = 0;

    // ── Categories ──
    for (const cat of categories) {
      try {
        if (cat.bjEntityId) {
          const entity = await prisma.category.findUnique({
            where: { id: cat.bjEntityId },
            select: { id: true, name: true, pfsCategoryId: true },
          });
          if (!entity) continue;
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
        }
      } catch { /* skip */ }
    }

    // ── Colors ──
    for (const col of colors) {
      try {
        if (col.bjEntityId) {
          const entity = await prisma.color.findUnique({
            where: { id: col.bjEntityId },
            select: { id: true, name: true, pfsColorRef: true },
          });
          if (!entity) continue;
          if (col.pfsReference && !entity.pfsColorRef) {
            await prisma.color.update({ where: { id: entity.id }, data: { pfsColorRef: col.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "color", pfsName: col.pfsName.toLowerCase() } },
            create: { type: "color", pfsName: col.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
        }
      } catch { /* skip */ }
    }

    // ── Compositions ──
    for (const comp of compositions) {
      try {
        if (comp.bjEntityId) {
          const entity = await prisma.composition.findUnique({
            where: { id: comp.bjEntityId },
            select: { id: true, name: true, pfsCompositionRef: true },
          });
          if (!entity) continue;
          if (comp.pfsReference && !entity.pfsCompositionRef) {
            await prisma.composition.update({ where: { id: entity.id }, data: { pfsCompositionRef: comp.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "composition", pfsName: comp.pfsName.toLowerCase() } },
            create: { type: "composition", pfsName: comp.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
        }
      } catch { /* skip */ }
    }

    // ── Countries ──
    for (const country of countries) {
      try {
        if (country.bjEntityId) {
          const entity = await prisma.manufacturingCountry.findUnique({
            where: { id: country.bjEntityId },
            select: { id: true, name: true, pfsCountryRef: true },
          });
          if (!entity) continue;
          if (country.pfsReference && !entity.pfsCountryRef) {
            await prisma.manufacturingCountry.update({ where: { id: entity.id }, data: { pfsCountryRef: country.pfsReference } });
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "country", pfsName: country.pfsName.toLowerCase() } },
            create: { type: "country", pfsName: country.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
        }
      } catch { /* skip */ }
    }

    // ── Seasons ──
    for (const season of seasons) {
      try {
        if (season.bjEntityId) {
          const entity = await prisma.season.findUnique({
            where: { id: season.bjEntityId },
            select: { id: true, name: true, pfsRef: true },
          });
          if (!entity) continue;
          if (season.pfsReference && !entity.pfsRef) {
            await prisma.season.update({ where: { id: entity.id }, data: { pfsRef: season.pfsReference.trim().toUpperCase() } }).catch(() => {});
          }
          await prisma.pfsMapping.upsert({
            where: { type_pfsName: { type: "season", pfsName: season.pfsName.toLowerCase() } },
            create: { type: "season", pfsName: season.pfsName.toLowerCase(), bjEntityId: entity.id, bjName: entity.name },
            update: { bjEntityId: entity.id, bjName: entity.name },
          });
        }
      } catch { /* skip */ }
    }

    // ── Sizes ──
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
        if (sizeRecord && sz.bjCategoryIds?.length) {
          for (const bjCatId of sz.bjCategoryIds) {
            await prisma.sizeCategoryLink.upsert({
              where: { sizeId_categoryId: { sizeId: sizeRecord.id, categoryId: bjCatId } },
              create: { sizeId: sizeRecord.id, categoryId: bjCatId },
              update: {},
            }).catch(() => { /* ignore duplicate */ });
          }
        }
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
      } catch { /* skip */ }
    }

    // Revalidate caches
    if (createdCategories > 0) revalidateTag("categories", "default");
    if (createdColors > 0) revalidateTag("colors", "default");
    if (createdCompositions > 0) revalidateTag("compositions", "default");
    if (createdCountries > 0) revalidateTag("manufacturing-countries", "default");
    if (createdSeasons > 0) revalidateTag("seasons", "default");
    if (createdSizes > 0) revalidateTag("sizes", "default");

    // ── Transition job to RUNNING and start prepare ──
    await prisma.pfsPrepareJob.update({
      where: { id: jobId },
      data: { status: "RUNNING" },
    });

    // Fire-and-forget prepare (pass limit from analyze if set)
    const analyzeData = job.analyzeResult as Record<string, unknown> | null;
    const limit = typeof analyzeData?.limit === "number" ? analyzeData.limit : undefined;
    runPfsPrepare(jobId, limit ? { limit } : undefined).catch((err) => logger.error("[PFS Validate] prepare failed", { error: err instanceof Error ? err.message : String(err) }));

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("[PFS Validate] Error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Erreur lors de la validation des entités" },
      { status: 500 },
    );
  }
}
