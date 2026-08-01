/**
 * Vide toutes les commandes marketplaces + fiches clients admin
 * pour retester un import propre en LOCAL.
 *
 * Périmètre :
 *  - MicrostoreOrder / PfsOrder / EfashionOrder / AnkorstoreOrder / FaireOrder
 *    (+ items en cascade)
 *  - AdminClientCard (+ AdminClientCardProductPurchase en cascade)
 *  - SiteConfig : reset des états d'import (state / stop / last_synced_at) pour
 *    que les widgets repartent d'IDLE et que la synchro auto re-scanne large.
 *
 * NE TOUCHE PAS :
 *  - User (comptes clients boutique)
 *  - Order (commandes boutique)
 *  - Products, catégories, couleurs, tailles, panier, config marketplace, etc.
 *
 * Safety guards :
 *  - Refuse de tourner si DATABASE_URL ne contient pas `localhost` ou `127.0.0.1`
 *  - Confirme le tenant ciblé avant suppression
 *
 * Lancement :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/wipe-marketplaces-orders-local.ts --yes
 */
import { prisma } from "@/lib/prisma";

async function main() {
  // 1. Guard local uniquement
  const dbUrl = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1/i.test(dbUrl);
  if (!isLocal) {
    console.error("❌ REFUS : DATABASE_URL ne pointe pas vers localhost.");
    console.error("   URL détectée :", dbUrl.replace(/\/\/[^@]*@/, "//***:***@"));
    process.exit(1);
  }

  // 2. Confirmation par --yes (sinon dry-run avec récap)
  const confirmed = process.argv.includes("--yes");

  // 3. Lister les tenants + compter les rows
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
  });

  console.log("=== Bases ciblées ===");
  console.log("DATABASE_URL :", dbUrl.replace(/\/\/[^@]*@/, "//***:***@"));
  console.log("Tenants      :", tenants.map((t) => `${t.slug} (${t.id})`).join(", "));
  console.log();

  const totalCounts = {
    microstoreOrder: 0,
    pfsOrder: 0,
    efashionOrder: 0,
    ankorstoreOrder: 0,
    faireOrder: 0,
    adminClientCard: 0,
  };
  for (const t of tenants) {
    const [mc, pfs, ef, ank, fa, cards] = await Promise.all([
      prisma.microstoreOrder.count({ where: { tenantId: t.id } }),
      prisma.pfsOrder.count({ where: { tenantId: t.id } }),
      prisma.efashionOrder.count({ where: { tenantId: t.id } }),
      prisma.ankorstoreOrder.count({ where: { tenantId: t.id } }),
      prisma.faireOrder.count({ where: { tenantId: t.id } }),
      prisma.adminClientCard.count({ where: { tenantId: t.id } }),
    ]);
    console.log(`— ${t.slug} :`);
    console.log(`   Microstore  ${mc}  |  PFS  ${pfs}  |  eFashion  ${ef}  |  Ankor  ${ank}  |  Faire  ${fa}`);
    console.log(`   Fiches clients admin : ${cards}`);
    totalCounts.microstoreOrder += mc;
    totalCounts.pfsOrder += pfs;
    totalCounts.efashionOrder += ef;
    totalCounts.ankorstoreOrder += ank;
    totalCounts.faireOrder += fa;
    totalCounts.adminClientCard += cards;
  }
  console.log();
  console.log("=== Totaux ===");
  console.log(totalCounts);

  if (!confirmed) {
    console.log();
    console.log("⚠  Dry-run — relance avec --yes pour SUPPRIMER.");
    process.exit(0);
  }

  // 4. Suppression (ordre : commandes d'abord, fiches clients ensuite)
  console.log();
  console.log("=== SUPPRESSION en cours ===");
  const results = {
    microstoreOrder: 0,
    pfsOrder: 0,
    efashionOrder: 0,
    ankorstoreOrder: 0,
    faireOrder: 0,
    adminClientCard: 0,
    siteConfig: 0,
  };

  // Pas de $transaction : les deleteMany prennent > 5 s (timeout Prisma par
  // défaut) sur ~2 400 commandes + items en cascade. Chaque deleteMany est
  // déjà atomique côté SQL. Ordre : commandes d'abord (les FK vers
  // AdminClientCard sont en SetNull, donc supprimer les commandes met les
  // références à null → aucune contrainte ne bloque la suppression des fiches).
  console.log("→ Microstore…");
  results.microstoreOrder = (await prisma.microstoreOrder.deleteMany({})).count;
  console.log("→ PFS…");
  results.pfsOrder = (await prisma.pfsOrder.deleteMany({})).count;
  console.log("→ eFashion…");
  results.efashionOrder = (await prisma.efashionOrder.deleteMany({})).count;
  console.log("→ Ankorstore…");
  results.ankorstoreOrder = (await prisma.ankorstoreOrder.deleteMany({})).count;
  console.log("→ Faire…");
  results.faireOrder = (await prisma.faireOrder.deleteMany({})).count;
  console.log("→ Fiches clients admin…");
  results.adminClientCard = (await prisma.adminClientCard.deleteMany({})).count;
  console.log("→ SiteConfig (états d'import)…");
  results.siteConfig = (await prisma.siteConfig.deleteMany({
    where: {
      key: {
        in: [
          "microstore_orders_import_state",
          "microstore_orders_import_stop",
          "microstore_orders_last_synced_at",
          "pfs_orders_import_state",
          "pfs_orders_import_stop",
          "pfs_orders_last_synced_at",
          "efashion_orders_import_state",
          "efashion_orders_import_stop",
          "efashion_orders_last_synced_at",
          "ankorstore_orders_import_state",
          "ankorstore_orders_import_stop",
          "ankorstore_orders_last_synced_at",
          "faire_orders_import_state",
          "faire_orders_import_stop",
          "faire_orders_last_synced_at",
        ],
      },
    },
  })).count;

  console.log("✅ Terminé.");
  console.log(results);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Erreur :", err);
  await prisma.$disconnect();
  process.exit(1);
});
