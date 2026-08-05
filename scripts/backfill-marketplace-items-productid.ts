// Re-relie rétroactivement les items marketplace dont productId=NULL alors qu'un
// Product BJ avec la même référence (case-insensitive) existe côté même tenant.
//
// Contexte : la logique historique de sync utilisait Map.get(reference) côté JS
// (case-sensitive), alors que MySQL utf8mb4_unicode_ci matche case-insensitive.
// Résultat : un item PFS "7563b" ne se rattachait pas au Product "7563B" et
// s'affichait « Produit non présent sur notre site » dans Top produits.
// Le code de sync est fixé, ce script rattrape l'historique.
//
// Usage : MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-marketplace-items-productid.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Stats {
  scanned: number;
  linked: number;
  stillOrphan: number;
}

async function backfillTable<T extends { id: string; tenantId: string; refValue: string | null }>(
  label: string,
  fetchOrphans: () => Promise<T[]>,
  linkOne: (id: string, productId: string, productName: string | null) => Promise<void>,
): Promise<Stats> {
  const orphans = await fetchOrphans();
  const stats: Stats = { scanned: orphans.length, linked: 0, stillOrphan: 0 };
  if (orphans.length === 0) {
    console.log(`  ${label} : rien à traiter.`);
    return stats;
  }

  // Grouper les refs par tenant → 1 findMany par tenant.
  const refsByTenant = new Map<string, Set<string>>();
  for (const o of orphans) {
    if (!o.refValue) continue;
    const bag = refsByTenant.get(o.tenantId) ?? new Set<string>();
    bag.add(o.refValue);
    refsByTenant.set(o.tenantId, bag);
  }

  // Charger les produits par tenant. On stocke en Map<lowercased ref, product>.
  const productByTenantByLcRef = new Map<string, Map<string, { id: string; name: string | null }>>();
  for (const [tenantId, refs] of refsByTenant) {
    const products = await prisma.product.findMany({
      where: { tenantId, reference: { in: Array.from(refs) } },
      select: { id: true, reference: true, name: true },
    });
    const lcMap = new Map<string, { id: string; name: string | null }>();
    for (const p of products) lcMap.set(p.reference.toLowerCase(), { id: p.id, name: p.name });
    productByTenantByLcRef.set(tenantId, lcMap);
  }

  for (const o of orphans) {
    if (!o.refValue) {
      stats.stillOrphan++;
      continue;
    }
    const match = productByTenantByLcRef.get(o.tenantId)?.get(o.refValue.toLowerCase());
    if (!match) {
      stats.stillOrphan++;
      continue;
    }
    await linkOne(o.id, match.id, match.name);
    stats.linked++;
  }

  console.log(
    `  ${label} : ${stats.linked} reliés · ${stats.stillOrphan} restent orphelins · scanné ${stats.scanned}`,
  );
  return stats;
}

async function main() {
  console.log("Backfill marketplace items → productId (case-insensitive rematch)\n");

  console.log("PfsOrderItem…");
  const pfs = await backfillTable(
    "PFS",
    async () => {
      const rows = await prisma.pfsOrderItem.findMany({
        where: { productId: null, pfsProductRef: { not: "" } },
        select: { id: true, tenantId: true, pfsProductRef: true },
      });
      return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, refValue: r.pfsProductRef }));
    },
    (id, productId, productName) =>
      prisma.pfsOrderItem
        .update({
          where: { id },
          data: { productId, productSnapshotName: productName },
        })
        .then(() => undefined),
  );

  console.log("EfashionOrderItem…");
  const efa = await backfillTable(
    "eFashion",
    async () => {
      const rows = await prisma.efashionOrderItem.findMany({
        where: { productId: null, referenceBase: { not: "" } },
        select: { id: true, tenantId: true, referenceBase: true },
      });
      return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, refValue: r.referenceBase }));
    },
    (id, productId, productName) =>
      prisma.efashionOrderItem
        .update({
          where: { id },
          data: { productId, productSnapshotName: productName },
        })
        .then(() => undefined),
  );

  console.log("AnkorstoreOrderItem…");
  const ank = await backfillTable(
    "Ankorstore",
    async () => {
      const rows = await prisma.ankorstoreOrderItem.findMany({
        where: { productId: null, referenceBase: { not: null } },
        select: { id: true, tenantId: true, referenceBase: true },
      });
      return rows
        .filter((r) => r.referenceBase && r.referenceBase.length > 0)
        .map((r) => ({ id: r.id, tenantId: r.tenantId, refValue: r.referenceBase }));
    },
    (id, productId, productName) =>
      prisma.ankorstoreOrderItem
        .update({
          where: { id },
          data: { productId, productSnapshotName: productName },
        })
        .then(() => undefined),
  );

  console.log("FaireOrderItem…");
  const faire = await backfillTable(
    "Faire",
    async () => {
      const rows = await prisma.faireOrderItem.findMany({
        where: { productId: null, referenceBase: { not: null } },
        select: { id: true, tenantId: true, referenceBase: true },
      });
      return rows
        .filter((r) => r.referenceBase && r.referenceBase.length > 0)
        .map((r) => ({ id: r.id, tenantId: r.tenantId, refValue: r.referenceBase }));
    },
    (id, productId, productName) =>
      prisma.faireOrderItem
        .update({
          where: { id },
          data: { productId, productSnapshotName: productName },
        })
        .then(() => undefined),
  );

  console.log("MicrostoreOrderItem…");
  const micro = await backfillTable(
    "Microstore",
    async () => {
      const rows = await prisma.microstoreOrderItem.findMany({
        where: { productId: null, itemRef: { not: "" } },
        select: { id: true, tenantId: true, itemRef: true },
      });
      return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, refValue: r.itemRef }));
    },
    (id, productId) =>
      prisma.microstoreOrderItem
        .update({ where: { id }, data: { productId } })
        .then(() => undefined),
  );

  const totalLinked = pfs.linked + efa.linked + ank.linked + faire.linked + micro.linked;
  const totalOrphan =
    pfs.stillOrphan + efa.stillOrphan + ank.stillOrphan + faire.stillOrphan + micro.stillOrphan;
  console.log(`\n✔ Total : ${totalLinked} items reliés · ${totalOrphan} restent orphelins`);
  console.log(
    "  (les orphelins restants ont une référence marketplace qui ne correspond à aucun Product BJ)",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
