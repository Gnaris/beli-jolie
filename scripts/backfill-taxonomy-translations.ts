/**
 * scripts/backfill-taxonomy-translations.ts
 *
 * Backfill one-shot : complète les traductions de nom pour les tables de
 * taxonomie (Category/SubCategory/Color/Composition/Tag/Season/Collection)
 * d'un tenant donné. Appelle l'API PFS (gratuite, 5 locales par call).
 *
 * Idempotent : pour chaque entité, si une locale (en/de/es/it) a déjà un nom,
 * on la saute. On n'écrit que les locales manquantes.
 *
 * Usage :
 *   npx tsx scripts/backfill-taxonomy-translations.ts --tenant=issyma
 *   npx tsx scripts/backfill-taxonomy-translations.ts --tenant=beliandjolie --types=tag
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases } from "@/lib/pfs-translate";

const TARGET_LOCALES = ["en", "de", "es", "it"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

type EntityKind =
  | "category"
  | "subcategory"
  | "color"
  | "composition"
  | "tag"
  | "season"
  | "collection";

const ALL_KINDS: EntityKind[] = [
  "category",
  "subcategory",
  "color",
  "composition",
  "tag",
  "season",
  "collection",
];

const BATCH_SIZE = 15;

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  const typesArg = args.find((a) => a.startsWith("--types="))?.split("=")[1];
  if (!slug) {
    console.error("Usage: --tenant=<slug> [--types=category,color,...]");
    process.exit(1);
  }
  const kinds: EntityKind[] = typesArg
    ? (typesArg.split(",").map((s) => s.trim()) as EntityKind[])
    : ALL_KINDS;

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" introuvable`);
    process.exit(1);
  }

  await tenantALS.run(tenant.id, () => backfillAll(tenant.slug, tenant.id, kinds));
}

async function backfillAll(slug: string, tenantId: string, kinds: EntityKind[]) {
  for (const kind of kinds) {
    await backfillKind(slug, tenantId, kind);
  }
}

interface EntityRow {
  id: string;
  name: string;
  existingLocales: Set<string>;
}

async function loadEntities(kind: EntityKind, tenantId: string): Promise<EntityRow[]> {
  switch (kind) {
    case "category": {
      const rows = await prisma.category.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "subcategory": {
      const rows = await prisma.subCategory.findMany({
        where: { category: { tenantId } },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "color": {
      const rows = await prisma.color.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "composition": {
      const rows = await prisma.composition.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "tag": {
      const rows = await prisma.tag.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "season": {
      const rows = await prisma.season.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
    case "collection": {
      const rows = await prisma.collection.findMany({
        where: { tenantId },
        select: { id: true, name: true, translations: { select: { locale: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        existingLocales: new Set(r.translations.map((t) => t.locale)),
      }));
    }
  }
}

async function upsertTranslation(
  kind: EntityKind,
  entityId: string,
  locale: string,
  name: string,
) {
  switch (kind) {
    case "category":
      return prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: entityId, locale } },
        update: { name },
        create: { categoryId: entityId, locale, name },
      });
    case "subcategory":
      return prisma.subCategoryTranslation.upsert({
        where: { subCategoryId_locale: { subCategoryId: entityId, locale } },
        update: { name },
        create: { subCategoryId: entityId, locale, name },
      });
    case "color":
      return prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId: entityId, locale } },
        update: { name },
        create: { colorId: entityId, locale, name },
      });
    case "composition":
      return prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: entityId, locale } },
        update: { name },
        create: { compositionId: entityId, locale, name },
      });
    case "tag":
      return prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: entityId, locale } },
        update: { name },
        create: { tagId: entityId, locale, name },
      });
    case "season":
      return prisma.seasonTranslation.upsert({
        where: { seasonId_locale: { seasonId: entityId, locale } },
        update: { name },
        create: { seasonId: entityId, locale, name },
      });
    case "collection":
      return prisma.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: entityId, locale } },
        update: { name },
        create: { collectionId: entityId, locale, name },
      });
  }
}

async function backfillKind(slug: string, _tenantId: string, kind: EntityKind) {
  const rows = await loadEntities(kind, _tenantId);
  if (rows.length === 0) {
    console.log(`[${slug}][${kind}] 0 entité — skip`);
    return;
  }

  const todo = rows.filter((r) => !TARGET_LOCALES.every((l) => r.existingLocales.has(l)));
  if (todo.length === 0) {
    console.log(`[${slug}][${kind}] ${rows.length} entité(s), tout est déjà traduit ✓`);
    return;
  }

  console.log(`[${slug}][${kind}] ${todo.length}/${rows.length} entité(s) à compléter`);

  let writes = 0;
  let failures = 0;
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const phrases: Record<string, string> = {};
    for (const r of batch) {
      if (r.name?.trim()) phrases[r.id] = r.name;
    }
    let result: Awaited<ReturnType<typeof translatePhrases>> = null;
    try {
      result = await translatePhrases(phrases);
    } catch (err) {
      console.warn(`  Batch ${i / BATCH_SIZE + 1} : exception`, err);
    }
    if (!result) {
      failures += batch.length;
      continue;
    }

    const ops: Promise<unknown>[] = [];
    for (const r of batch) {
      const perLocale = result[r.id] ?? {};
      for (const loc of TARGET_LOCALES) {
        if (r.existingLocales.has(loc)) continue;
        const value = perLocale[loc]?.trim();
        if (!value) continue;
        ops.push(upsertTranslation(kind, r.id, loc, value));
        writes++;
      }
    }
    if (ops.length) await Promise.all(ops);
  }

  console.log(`[${slug}][${kind}] Terminé : ${writes} traduction(s) écrite(s), ${failures} échec(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
