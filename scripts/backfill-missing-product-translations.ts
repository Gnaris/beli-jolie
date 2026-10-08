/**
 * scripts/backfill-missing-product-translations.ts
 *
 * Backfill one-shot : complète les ProductTranslation manquantes (de/it/es)
 * pour un tenant donné via l'API de traduction PFS (gratuite, 5 locales par
 * call). Ignore EN qui est déjà couvert par l'auto-translate fire-and-forget.
 *
 * Usage :
 *   npx tsx scripts/backfill-missing-product-translations.ts --tenant=beliandjolie
 *   npx tsx scripts/backfill-missing-product-translations.ts --tenant=issyma
 *
 * Idempotent : upsert par (productId, locale). Un produit déjà traduit dans
 * une locale n'est pas re-traduit (gain d'appels PFS + préserve le travail
 * manuel éventuel même sans flag `manualEdit`).
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { translatePhrases } from "@/lib/pfs-translate";

const TARGET_LOCALES = ["de", "es", "it"] as const;
const BATCH_SIZE = 10;

async function main() {
  const slugArg = process.argv.find((a) => a.startsWith("--tenant="));
  const slug = slugArg?.split("=")[1];
  if (!slug) {
    console.error("Usage: --tenant=<slug>");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" introuvable`);
    process.exit(1);
  }

  await tenantALS.run(tenant.id, () => backfill(tenant.slug, tenant.id));
}

async function backfill(slug: string, tenantId: string) {
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      OR: TARGET_LOCALES.map((loc) => ({
        translations: { none: { locale: loc } },
      })),
    },
    select: {
      id: true,
      name: true,
      description: true,
      translations: { select: { locale: true } },
    },
  });

  const total = products.length;
  console.log(`[${slug}] ${total} produit(s) avec au moins 1 locale manquante`);

  if (total === 0) {
    console.log(`[${slug}] Rien à faire ✓`);
    return;
  }

  let processed = 0;
  let localeWrites = 0;
  let batchFailures = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const phrases: Record<string, string> = {};
    for (const p of batch) {
      if (p.name?.trim()) phrases[`n_${p.id}`] = p.name;
      if (p.description?.trim()) phrases[`d_${p.id}`] = p.description;
    }

    let result: Awaited<ReturnType<typeof translatePhrases>> = null;
    try {
      result = await translatePhrases(phrases);
    } catch (err) {
      console.warn(`  Batch ${i / BATCH_SIZE + 1} : exception`, err);
    }

    if (!result) {
      batchFailures++;
      processed += batch.length;
      continue;
    }

    const ops = [];
    for (const p of batch) {
      const existing = new Set(p.translations.map((t) => t.locale));
      for (const loc of TARGET_LOCALES) {
        if (existing.has(loc)) continue;

        const nameTr = result[`n_${p.id}`]?.[loc]?.trim() ?? "";
        const descTr = result[`d_${p.id}`]?.[loc]?.trim() ?? "";
        if (!nameTr) continue;

        ops.push(
          prisma.productTranslation.upsert({
            where: { productId_locale: { productId: p.id, locale: loc } },
            update: { name: nameTr, description: descTr },
            create: {
              productId: p.id,
              locale: loc,
              name: nameTr,
              description: descTr,
            },
          }),
        );
        localeWrites++;
      }
    }

    if (ops.length) await prisma.$transaction(ops);
    processed += batch.length;

    if ((i / BATCH_SIZE) % 5 === 0 || processed === total) {
      console.log(
        `  ${processed}/${total} produits traités · ${localeWrites} traductions écrites · ${batchFailures} batch(es) en échec`,
      );
    }
  }

  console.log(
    `[${slug}] Terminé : ${processed} produits, ${localeWrites} traductions ajoutées, ${batchFailures} batch(es) en échec`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
