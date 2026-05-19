/**
 * Diagnostic : combien de produits BJ devraient être sur Ankorstore mais
 * ne le sont pas (= candidats brouillon côté AS) ?
 *
 * Lecture seule, aucune action.
 *
 * Usage : npx tsx scripts/ankorstore-link-gap.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const total = await prisma.product.count();
  const archived = await prisma.product.count({ where: { status: "ARCHIVED" } });
  const active = total - archived;

  const linked = await prisma.product.count({
    where: { status: { not: "ARCHIVED" }, ankorsProductId: { not: null } },
  });
  const unlinked = await prisma.product.count({
    where: { status: { not: "ARCHIVED" }, ankorsProductId: null },
  });

  // Combien de produits sans liaison ont au moins un essai de publish en BDD ?
  const unlinkedWithFailedOp = await prisma.product.count({
    where: {
      status: { not: "ARCHIVED" },
      ankorsProductId: null,
      ankorstoreOperations: {
        some: { status: { in: ["FAILED", "PARTIALLY_FAILED"] } },
      },
    },
  });

  // Combien sans liaison ET sans trace d'opération ? (= jamais tentés ou bien
  // tentés avant la mise en place du tracking AnkorstoreOperation)
  const unlinkedNoOpTrace = await prisma.product.count({
    where: {
      status: { not: "ARCHIVED" },
      ankorsProductId: null,
      ankorstoreOperations: { none: {} },
    },
  });

  // Par statut
  const byStatus = await prisma.product.groupBy({
    by: ["status"],
    where: { ankorsProductId: null },
    _count: { _all: true },
  });

  console.log("=== Inventaire produits Beli & Jolie ===");
  console.log(`Total                              : ${total}`);
  console.log(`  ARCHIVED localement              : ${archived}`);
  console.log(`  Actifs (ONLINE/OFFLINE/SYNCING)  : ${active}`);
  console.log();
  console.log("=== Côté Ankorstore (parmi les actifs) ===");
  console.log(`  Liés (ankorsProductId présent)   : ${linked}`);
  console.log(`  Non liés (ankorsProductId NULL)  : ${unlinked}`);
  console.log();
  console.log("=== Origine des non-liés ===");
  console.log(`  Tentative trackée en échec       : ${unlinkedWithFailedOp}`);
  console.log(`  Aucune trace d'opération en BDD  : ${unlinkedNoOpTrace}`);
  console.log(`  (Reste : PENDING ou succès ancien revoqué)`);
  console.log();
  console.log("=== Répartition par statut des non-liés ===");
  for (const r of byStatus) {
    console.log(`  ${r.status.padEnd(10)} : ${r._count._all}`);
  }

  // Comparaison à 616 brouillons signalés côté AS
  console.log();
  console.log("=== Cohérence avec les 616 brouillons côté Ankorstore ===");
  if (unlinked >= 616) {
    console.log(
      `OK : on a ${unlinked} produits non liés côté nous, ≥ 616 brouillons côté AS.`,
    );
    console.log(
      `→ Chaque brouillon AS correspond probablement à un produit local non lié.`,
    );
  } else {
    console.log(
      `Mismatch : seulement ${unlinked} produits non liés, mais 616 brouillons côté AS.`,
    );
    console.log(`Hypothèses possibles :`);
    console.log(
      `  - Des brouillons orphelins (produits supprimés côté BJ mais drafts restés AS)`,
    );
    console.log(
      `  - Des doublons de brouillons (plusieurs tentatives pour le même produit)`,
    );
    console.log(
      `  - L'ancien système Excel a créé plusieurs drafts par produit`,
    );
  }
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
