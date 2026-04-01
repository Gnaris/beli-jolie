import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { PfsSyncStatus } from "@prisma/client";
import { runEfashionPrepare } from "@/lib/efashion-prepare";

// ─────────────────────────────────────────────
// POST — Create/link entity mappings from eFashion analyze
// ─────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface MappingInput {
  type: string; // "category" | "color" | "composition"
  efashionName: string;
  efashionId?: number;
  bjEntityId?: string;
  bjName?: string;
  // For category creation
  name?: string;
  hex?: string | null;
  patternImage?: string | null;
}

interface RequestBody {
  jobId?: string;
  mappings: MappingInput[];
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body: RequestBody = await req.json();
    const { jobId, mappings } = body;

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ error: "mappings doit être un tableau non vide" }, { status: 400 });
    }

    let createdCategories = 0;
    let createdColors = 0;
    let createdCompositions = 0;
    let upsertedMappings = 0;

    for (const mapping of mappings) {
      const { type, efashionName, efashionId, bjEntityId, bjName } = mapping;

      if (!type || !efashionName) {
        logger.warn("[eFashion] Skipping mapping with missing type or efashionName", { mapping });
        continue;
      }

      let resolvedBjEntityId = bjEntityId;
      let resolvedBjName = bjName || efashionName;

      // If no bjEntityId, create the entity
      if (!resolvedBjEntityId) {
        const entityName = mapping.name || efashionName;

        if (type === "category") {
          const existing = await prisma.category.findFirst({ where: { name: entityName } });
          if (existing) {
            resolvedBjEntityId = existing.id;
            resolvedBjName = existing.name;
          } else {
            const created = await prisma.category.create({
              data: { name: entityName, slug: slugify(entityName) },
            });
            resolvedBjEntityId = created.id;
            resolvedBjName = created.name;
            createdCategories++;
          }
        } else if (type === "color") {
          const existing = await prisma.color.findFirst({ where: { name: entityName } });
          if (existing) {
            resolvedBjEntityId = existing.id;
            resolvedBjName = existing.name;
          } else {
            const created = await prisma.color.create({
              data: {
                name: entityName,
                hex: mapping.hex ?? null,
                patternImage: mapping.patternImage ?? null,
              },
            });
            resolvedBjEntityId = created.id;
            resolvedBjName = created.name;
            createdColors++;
          }
        } else if (type === "composition") {
          const existing = await prisma.composition.findFirst({ where: { name: entityName } });
          if (existing) {
            resolvedBjEntityId = existing.id;
            resolvedBjName = existing.name;
          } else {
            const created = await prisma.composition.create({
              data: { name: entityName },
            });
            resolvedBjEntityId = created.id;
            resolvedBjName = created.name;
            createdCompositions++;
          }
        } else {
          logger.warn(`[eFashion] Unknown mapping type: ${type}`);
          continue;
        }
      }

      // Upsert the EfashionMapping record
      await prisma.efashionMapping.upsert({
        where: {
          type_efashionName: { type, efashionName: efashionName.toLowerCase() },
        },
        create: {
          type,
          efashionName: efashionName.toLowerCase(),
          efashionId: efashionId ?? null,
          bjEntityId: resolvedBjEntityId!,
          bjName: resolvedBjName,
        },
        update: {
          efashionId: efashionId ?? undefined,
          bjEntityId: resolvedBjEntityId!,
          bjName: resolvedBjName,
        },
      });
      upsertedMappings++;
    }

    // Revalidate caches
    if (createdCategories > 0) revalidateTag("categories", "default");
    if (createdColors > 0) revalidateTag("colors", "default");
    if (createdCompositions > 0) revalidateTag("compositions", "default");

    // If jobId provided, transition from NEEDS_VALIDATION to RUNNING
    if (jobId) {
      const job = await prisma.efashionPrepareJob.findUnique({
        where: { id: jobId },
        select: { status: true, analyzeResult: true },
      });

      if (job && job.status === PfsSyncStatus.NEEDS_VALIDATION) {
        // Recover limit from analyzeResult (set during analyze phase)
        const analyzeResult = job.analyzeResult as Record<string, unknown> | null;
        const savedLimit = typeof analyzeResult?.limit === "number" ? analyzeResult.limit : 0;

        await prisma.efashionPrepareJob.update({
          where: { id: jobId },
          data: { status: PfsSyncStatus.RUNNING },
        });

        // Fire-and-forget prepare — propagate original limit
        runEfashionPrepare(jobId, savedLimit > 0 ? { limit: savedLimit } : undefined).catch((err) =>
          logger.error("[eFashion Import] Prepare failed after entity creation", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    return NextResponse.json({
      success: true,
      created: {
        categories: createdCategories,
        colors: createdColors,
        compositions: createdCompositions,
      },
      mappings: upsertedMappings,
    });
  } catch (error) {
    logger.error("[eFashion] create-entities error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Erreur lors de la création des entités" },
      { status: 500 },
    );
  }
}
