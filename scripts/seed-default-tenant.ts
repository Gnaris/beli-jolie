import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_TENANT_SLUG = "beli-jolie";
const DEFAULT_TENANT_NAME = "Beli & Jolie";
const DEFAULT_TENANT_HOSTS: Array<{ host: string; isPrimary: boolean }> = [
  { host: "beliandjolie.com", isPrimary: true },
  { host: "www.beliandjolie.com", isPrimary: false },
  { host: "localhost:3000", isPrimary: false },
  { host: "localhost", isPrimary: false },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: { name: DEFAULT_TENANT_NAME, isActive: true },
    create: { slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME, isActive: true },
  });

  for (const { host, isPrimary } of DEFAULT_TENANT_HOSTS) {
    await prisma.tenantDomain.upsert({
      where: { host },
      update: { tenantId: tenant.id, isPrimary },
      create: { tenantId: tenant.id, host, isPrimary },
    });
  }

  const domains = await prisma.tenantDomain.findMany({
    where: { tenantId: tenant.id },
    orderBy: { isPrimary: "desc" },
  });

  console.log(`[seed-tenant] Tenant ${tenant.slug} (${tenant.id}) — ${tenant.name}`);
  console.log(`[seed-tenant] Domaines :`);
  for (const d of domains) {
    console.log(`  - ${d.host}${d.isPrimary ? " (primaire)" : ""}`);
  }
}

main()
  .catch((err) => {
    console.error("[seed-tenant] Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
