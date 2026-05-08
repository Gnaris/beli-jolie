/**
 * Supprime toutes les traductions stockées en BDD pour les locales qui ne sont
 * plus servies par le site. Ne touche jamais aux contenus FR (qui vivent dans
 * la table principale) ni aux locales encore actives.
 *
 * Usage : `npx tsx scripts/purge-unused-locales.ts`
 *         (en local : par défaut. Sur prod : exécuter via SSH après validation.)
 *
 * Aucune confirmation interactive : à lancer sciemment.
 */

import { prisma } from "@/lib/prisma";
import { VALID_LOCALES } from "@/i18n/locales";

const ACTIVE = new Set<string>(VALID_LOCALES);

async function main() {
  console.log(`Locales actives : ${[...ACTIVE].join(", ")}`);
  console.log("Suppression des traductions pour toutes les autres locales…\n");

  const tables = [
    { name: "ProductTranslation", fn: () => prisma.productTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "CategoryTranslation", fn: () => prisma.categoryTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "SubCategoryTranslation", fn: () => prisma.subCategoryTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "ColorTranslation", fn: () => prisma.colorTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "ManufacturingCountryTranslation", fn: () => prisma.manufacturingCountryTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "SeasonTranslation", fn: () => prisma.seasonTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "CompositionTranslation", fn: () => prisma.compositionTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "TagTranslation", fn: () => prisma.tagTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
    { name: "CollectionTranslation", fn: () => prisma.collectionTranslation.deleteMany({ where: { locale: { notIn: [...ACTIVE] } } }) },
  ];

  let total = 0;
  for (const t of tables) {
    const r = await t.fn();
    console.log(`  ${t.name.padEnd(35)} → ${r.count} ligne(s) supprimée(s)`);
    total += r.count;
  }
  console.log(`\nTotal supprimé : ${total} ligne(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
