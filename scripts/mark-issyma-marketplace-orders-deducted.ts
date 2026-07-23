// Marque comme "déjà déduites du stock" toutes les lignes marketplace du tenant
// issyma qui sont actuellement dans la file "à déduire". N'écrit stockDeductedAt
// que si l'ordre parent est dans un statut qui alimente la file (celui utilisé
// par les libs lib/*-stock-deduction.ts). Ne touche PAS le stock réel.
//
// Usage :
//   npx tsx scripts/mark-issyma-marketplace-orders-deducted.ts          # dry-run (comptage uniquement)
//   npx tsx scripts/mark-issyma-marketplace-orders-deducted.ts --write  # applique
//
// IMPORTANT : lancer via MULTI_TENANT_SCOPE=off pour éviter tout scope ALS
// résiduel côté extension. Le script filtre lui-même par tenantId partout.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "issyma";
const WRITE_MODE = process.argv.includes("--write");

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    console.error(`[mark-deducted] Tenant introuvable : ${TENANT_SLUG}`);
    process.exit(1);
  }
  console.log(`[mark-deducted] Cible : ${tenant.slug} (${tenant.id})`);
  console.log(`[mark-deducted] Mode  : ${WRITE_MODE ? "ÉCRITURE" : "DRY-RUN (comptage seul)"}`);
  console.log("");

  const now = new Date();

  // ── PFS : statuts VALIDATED + SENT ───────────────────────────────
  const pfsWhere = {
    tenantId: tenant.id,
    stockDeductedAt: null,
    stockDeductionExcludedAt: null,
    pfsOrder: { status: { in: ["VALIDATED" as const, "SENT" as const] } },
  };
  const pfsCount = await prisma.pfsOrderItem.count({ where: pfsWhere });
  const pfsOrderCount = await prisma.pfsOrder.count({
    where: {
      tenantId: tenant.id,
      status: { in: ["VALIDATED", "SENT"] },
      items: { some: { stockDeductedAt: null, stockDeductionExcludedAt: null } },
    },
  });
  console.log(`[PFS]        ${pfsCount} lignes à marquer (issues de ${pfsOrderCount} commandes VALIDATED/SENT)`);

  // ── Ankorstore : statuts VALIDATED + SHIPPED (pas de stockDeductionExcludedAt) ──
  const ankWhere = {
    tenantId: tenant.id,
    stockDeductedAt: null,
    ankorstoreOrder: { status: { in: ["VALIDATED" as const, "SHIPPED" as const] } },
  };
  const ankCount = await prisma.ankorstoreOrderItem.count({ where: ankWhere });
  const ankOrderCount = await prisma.ankorstoreOrder.count({
    where: {
      tenantId: tenant.id,
      status: { in: ["VALIDATED", "SHIPPED"] },
      items: { some: { stockDeductedAt: null } },
    },
  });
  console.log(`[Ankorstore] ${ankCount} lignes à marquer (issues de ${ankOrderCount} commandes VALIDATED/SHIPPED)`);

  // ── eFashion : VALIDATED + SHIPPED (aligné sur ce que l'UI marque "À déduire",
  //    plus large que la lib backend qui ne traite que SHIPPED). ──
  const efaWhere = {
    tenantId: tenant.id,
    stockDeductedAt: null,
    efashionOrder: { status: { in: ["VALIDATED" as const, "SHIPPED" as const] } },
  };
  const efaCount = await prisma.efashionOrderItem.count({ where: efaWhere });
  const efaOrderCount = await prisma.efashionOrder.count({
    where: {
      tenantId: tenant.id,
      status: { in: ["VALIDATED", "SHIPPED"] },
      items: { some: { stockDeductedAt: null } },
    },
  });
  console.log(`[eFashion]   ${efaCount} lignes à marquer (issues de ${efaOrderCount} commandes VALIDATED/SHIPPED)`);

  // ── Faire : statut SHIPPED uniquement (pas de stockDeductionExcludedAt) ──
  const faiWhere = {
    tenantId: tenant.id,
    stockDeductedAt: null,
    faireOrder: { status: "SHIPPED" as const },
  };
  const faiCount = await prisma.faireOrderItem.count({ where: faiWhere });
  const faiOrderCount = await prisma.faireOrder.count({
    where: {
      tenantId: tenant.id,
      status: "SHIPPED",
      items: { some: { stockDeductedAt: null } },
    },
  });
  console.log(`[Faire]      ${faiCount} lignes à marquer (issues de ${faiOrderCount} commandes SHIPPED)`);

  const total = pfsCount + ankCount + efaCount + faiCount;
  console.log("");
  console.log(`[mark-deducted] TOTAL : ${total} lignes marketplace à marquer déduites.`);
  console.log("");

  if (!WRITE_MODE) {
    console.log(`[mark-deducted] Dry-run terminé. Relance avec --write pour appliquer.`);
    return;
  }

  if (total === 0) {
    console.log(`[mark-deducted] Rien à faire.`);
    return;
  }

  // ── Écriture : updateMany direct avec filtre relationnel (Prisma 5.14+ OK) ─
  const [pfsRes, ankRes, efaRes, faiRes] = await Promise.all([
    prisma.pfsOrderItem.updateMany({ where: pfsWhere, data: { stockDeductedAt: now } }),
    prisma.ankorstoreOrderItem.updateMany({ where: ankWhere, data: { stockDeductedAt: now } }),
    prisma.efashionOrderItem.updateMany({ where: efaWhere, data: { stockDeductedAt: now } }),
    prisma.faireOrderItem.updateMany({ where: faiWhere, data: { stockDeductedAt: now } }),
  ]);

  console.log(`[mark-deducted] PFS        : ${pfsRes.count} lignes marquées`);
  console.log(`[mark-deducted] Ankorstore : ${ankRes.count} lignes marquées`);
  console.log(`[mark-deducted] eFashion   : ${efaRes.count} lignes marquées`);
  console.log(`[mark-deducted] Faire      : ${faiRes.count} lignes marquées`);
  console.log(`[mark-deducted] Total appliqué : ${pfsRes.count + ankRes.count + efaRes.count + faiRes.count} lignes`);
}

main()
  .catch((err) => {
    console.error("[mark-deducted] Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
