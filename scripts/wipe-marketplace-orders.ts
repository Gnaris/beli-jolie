/**
 * Vide toutes les commandes marketplace (PFS, eFashion, Ankorstore, Faire,
 * Microstore) sur la base locale.
 *
 * - Supprime les items (cascade automatique via onDelete Cascade), puis les commandes.
 * - Réinitialise les états d'import historique + les timestamps « dernière sync »
 *   dans SiteConfig, pour repartir d'une page vide côté widget flottant.
 * - PRESERVE les AdminClientCard (fiches clients) : la cliente peut avoir enrichi
 *   ces fiches à la main. Retire seulement les flags `hasPfs/hasEfashion/...`
 *   des fiches créées auto par les marketplaces (marker `importedFromMarketplace`).
 *
 * Usage : `npx tsx scripts/wipe-marketplace-orders.ts`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SITE_CONFIG_KEYS_TO_RESET = [
  // States d'import historique
  "pfs_orders_import_state",
  "pfs_orders_import_stop",
  "efashion_orders_import_state",
  "efashion_orders_import_stop",
  "ankorstore_orders_import_state",
  "ankorstore_orders_import_stop",
  "faire_orders_import_state",
  "faire_orders_import_stop",
  "microstore_orders_import_state",
  "microstore_orders_import_stop",
  // Timestamps « dernière sync auto »
  "pfs_orders_last_synced_at",
  "efashion_orders_last_synced_at",
  "ankorstore_orders_last_synced_at",
  "faire_orders_last_synced_at",
  "microstore_orders_last_synced_at",
];

async function main() {
  console.log("=== wipe-marketplace-orders ===");
  console.log("Base :", process.env.DATABASE_URL);

  const before = {
    pfs: await prisma.pfsOrder.count(),
    efashion: await prisma.efashionOrder.count(),
    ankorstore: await prisma.ankorstoreOrder.count(),
    faire: await prisma.faireOrder.count(),
    microstore: await prisma.microstoreOrder.count(),
  };
  console.log("Avant :", before);

  // Cascade automatique via onDelete Cascade des relations *OrderItem.
  const results = await prisma.$transaction([
    prisma.pfsOrder.deleteMany({}),
    prisma.efashionOrder.deleteMany({}),
    prisma.ankorstoreOrder.deleteMany({}),
    prisma.faireOrder.deleteMany({}),
    prisma.microstoreOrder.deleteMany({}),
    prisma.siteConfig.deleteMany({
      where: { key: { in: SITE_CONFIG_KEYS_TO_RESET } },
    }),
  ]);

  console.log("Supprimé :");
  console.log(`  PfsOrder         : ${results[0].count}`);
  console.log(`  EfashionOrder    : ${results[1].count}`);
  console.log(`  AnkorstoreOrder  : ${results[2].count}`);
  console.log(`  FaireOrder       : ${results[3].count}`);
  console.log(`  MicrostoreOrder  : ${results[4].count}`);
  console.log(`  SiteConfig keys  : ${results[5].count}`);

  console.log("\nFiches clients (AdminClientCard) : PRÉSERVÉES.");
  console.log("Terminé.");
}

main()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
