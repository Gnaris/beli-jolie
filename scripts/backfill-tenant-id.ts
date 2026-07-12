import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_TENANT_SLUG = "beliandjolie";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
  if (!tenant) {
    console.error(`[backfill-tenant] Tenant introuvable : ${DEFAULT_TENANT_SLUG}. Lance d'abord scripts/seed-default-tenant.ts`);
    process.exit(1);
  }

  console.log(`[backfill-tenant] Cible : ${tenant.slug} (${tenant.id})`);

  const [users, products, orders, companyInfos] = await Promise.all([
    prisma.user.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.product.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.order.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
    prisma.companyInfo.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } }),
  ]);

  console.log(`[backfill-tenant] User        : ${users.count} lignes mises à jour`);
  console.log(`[backfill-tenant] Product     : ${products.count} lignes mises à jour`);
  console.log(`[backfill-tenant] Order       : ${orders.count} lignes mises à jour`);
  console.log(`[backfill-tenant] CompanyInfo : ${companyInfos.count} lignes mises à jour`);

  const [orphanUsers, orphanProducts, orphanOrders, orphanCompanyInfos] = await Promise.all([
    prisma.user.count({ where: { tenantId: null } }),
    prisma.product.count({ where: { tenantId: null } }),
    prisma.order.count({ where: { tenantId: null } }),
    prisma.companyInfo.count({ where: { tenantId: null } }),
  ]);

  console.log(`[backfill-tenant] Vérif orphelins : User=${orphanUsers} Product=${orphanProducts} Order=${orphanOrders} CompanyInfo=${orphanCompanyInfos}`);

  if (orphanUsers + orphanProducts + orphanOrders + orphanCompanyInfos > 0) {
    console.error(`[backfill-tenant] Des lignes n'ont pas été rattachées.`);
    process.exit(1);
  }

  console.log(`[backfill-tenant] OK.`);
}

main()
  .catch((err) => {
    console.error("[backfill-tenant] Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
