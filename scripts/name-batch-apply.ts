/**
 * Applique le payload du skill produits-nom en BDD seulement.
 * Aucune communication PFS / Ankorstore / eFashion.
 * Lève uniquement les drapeaux *SyncRequired pour les marketplaces déjà liées.
 *
 * Usage : npx tsx scripts/name-batch-apply.ts <chemin-vers-payload.json>
 *
 * Payload :
 * {
 *   "items": [
 *     {
 *       "ref": "A382",
 *       "name": "...",
 *       "description": "...",
 *       "nameEn": "...",          // optionnel — si présent, écrit ProductTranslation(locale=en)
 *       "descriptionEn": "...",   // optionnel — idem
 *       "tagNames": ["coeur", "ajouré"],
 *       "subCategoryNames": ["Boucles pendantes"]
 *     }
 *   ]
 * }
 */
import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { normalizeForCompare } from "@/lib/text-normalize";
import { prependAiNote } from "@/lib/ai-note";
import { computeMarketplaceSyncFlags } from "@/lib/marketplace-sync-flag";
import { revalidateTag } from "next/cache";

type Item = {
  ref: string;
  name: string;
  description: string;
  nameEn?: string;
  descriptionEn?: string;
  tagNames: string[];
  subCategoryNames: string[];
};

type Report = {
  ref: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  tagsCreated?: number;
  subCategoriesCreated?: number;
};

async function applyItem(item: Item, now: Date): Promise<Report> {
  const product = await prisma.product.findUnique({
    where: { reference: item.ref },
    select: {
      id: true,
      status: true,
      categoryId: true,
      note: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
    },
  });

  if (!product) return { ref: item.ref, status: "error", reason: "produit introuvable" };
  if (product.status === "ARCHIVED") {
    return { ref: item.ref, status: "skipped", reason: "ARCHIVED" };
  }

  // 1. Anti-doublon tags
  const existingTags = await prisma.tag.findMany({ select: { id: true, name: true } });
  const tagIdByNormalized = new Map<string, string>();
  for (const t of existingTags) {
    tagIdByNormalized.set(normalizeForCompare(t.name), t.id);
  }

  let tagsCreated = 0;
  const tagIds: string[] = [];
  for (const rawName of item.tagNames) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const norm = normalizeForCompare(trimmed);
    if (!norm) continue;
    let id = tagIdByNormalized.get(norm);
    if (!id) {
      // Stocké tel qu'envoyé (déjà en Capitalize côté page : première lettre en
      // majuscule, reste en minuscule). Anti-doublon fait via normalizeForCompare.
      const created = await prisma.tag.create({
        data: { name: trimmed },
        select: { id: true },
      });
      id = created.id;
      tagIdByNormalized.set(norm, id);
      tagsCreated++;
    }
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  // 2. Anti-doublon sous-catégories sous la catégorie principale du produit
  const existingSubs = await prisma.subCategory.findMany({
    where: { categoryId: product.categoryId },
    select: { id: true, name: true },
  });
  const subIdByNormalized = new Map<string, string>();
  for (const s of existingSubs) {
    subIdByNormalized.set(normalizeForCompare(s.name), s.id);
  }

  let subCategoriesCreated = 0;
  const subIds: string[] = [];
  for (const rawName of item.subCategoryNames) {
    const trimmed = rawName.trim();
    if (!trimmed) continue;
    const norm = normalizeForCompare(trimmed);
    if (!norm) continue;
    let id = subIdByNormalized.get(norm);
    if (!id) {
      const created = await prisma.subCategory.create({
        data: {
          name: trimmed,
          slug: norm.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          categoryId: product.categoryId,
        },
        select: { id: true },
      });
      id = created.id;
      subIdByNormalized.set(norm, id);
      subCategoriesCreated++;
    }
    if (!subIds.includes(id)) subIds.push(id);
  }

  // 3. Drapeaux marketplace
  const flagPatch = computeMarketplaceSyncFlags({
    pfsProductId: product.pfsProductId,
    ankorsProductId: product.ankorsProductId,
    efashionReferenceBase: product.efashionReferenceBase,
    faireProductId: product.faireProductId,
  });

  const nameEn = item.nameEn?.trim();
  const descriptionEn = item.descriptionEn?.trim();
  const hasEn = Boolean(nameEn && descriptionEn);

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        name: item.name.trim(),
        description: item.description.trim(),
        note: prependAiNote(product.note, now),
        subCategories: { connect: subIds.map((id) => ({ id })) },
        tags: {
          deleteMany: {},
          create: tagIds.map((tagId) => ({ tagId })),
        },
        ...flagPatch,
      },
    });

    if (hasEn) {
      // Traduction anglaise fournie : on la pose directement (pas de DeepL).
      // On efface uniquement la ligne 'en' précédente et on garde les autres locales intactes.
      await tx.productTranslation.deleteMany({
        where: { productId: product.id, locale: "en" },
      });
      await tx.productTranslation.create({
        data: {
          productId: product.id,
          locale: "en",
          name: nameEn!,
          description: descriptionEn!,
        },
      });
    } else {
      // Pas de traduction fournie : ancien comportement — efface tout, DeepL régénère en arrière-plan.
      await tx.productTranslation.deleteMany({ where: { productId: product.id } });
    }
  });

  // 4. Invalidation des caches (best-effort, peut échouer hors contexte Next)
  try {
    // @ts-expect-error - Next 16 accepte 2 args (tag, defaultLifetime)
    revalidateTag("tags", "default");
    // @ts-expect-error - Next 16 accepte 2 args (tag, defaultLifetime)
    revalidateTag("sub-categories", "default");
    // @ts-expect-error - Next 16 accepte 2 args (tag, defaultLifetime)
    revalidateTag(`product:${product.id}`, "default");
  } catch {
    // ignore
  }

  return {
    ref: item.ref,
    status: "ok",
    tagsCreated,
    subCategoriesCreated,
  };
}

(async () => {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: npx tsx scripts/name-batch-apply.ts <payload.json>");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8")) as { items: Item[] };
  console.log(`📋 ${payload.items.length} produit(s) à appliquer.`);

  const now = new Date();
  const reports: Report[] = [];
  for (const item of payload.items) {
    try {
      const r = await applyItem(item, now);
      reports.push(r);
      console.log(`  ${item.ref} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
    } catch (e: any) {
      const r: Report = { ref: item.ref, status: "error", reason: e?.message ?? String(e) };
      reports.push(r);
      console.log(`  ${item.ref} → error: ${r.reason}`);
    }
  }

  console.log("\n=== RAPPORT ===");
  console.log(JSON.stringify(reports, null, 2));
  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
