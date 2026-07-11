/**
 * Crée un 2e tenant « demo » avec des données distinctes pour valider
 * l'isolation multi-tenant. À lancer une fois avant les tests.
 * Idempotent — les données existantes sont re-upsertées.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 1. Tenant demo
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: { name: "Demo Boutique", isActive: true },
    create: { slug: "demo", name: "Demo Boutique", isActive: true },
  });
  console.log(`[seed-demo] Tenant : ${tenant.slug} (${tenant.id})`);

  // 2. Domaines pour demo
  const hosts = [
    { host: "demo.beliandjolie.com", isPrimary: true },
    { host: "demo.local", isPrimary: false },
  ];
  for (const { host, isPrimary } of hosts) {
    await prisma.tenantDomain.upsert({
      where: { host },
      update: { tenantId: tenant.id, isPrimary },
      create: { tenantId: tenant.id, host, isPrimary },
    });
  }
  console.log(`[seed-demo] Domaines : ${hosts.map((h) => h.host).join(", ")}`);

  // 3. Admin demo distinct
  const adminEmail = "admin-demo@test.local";
  const hash = await bcrypt.hash("demo-password", 10);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hash,
      firstName: "Admin",
      lastName: "Demo",
      company: "Demo Boutique",
      phone: "+33 0 00 00 00 00",
      siret: "99999999900099",
      role: "ADMIN",
      status: "APPROVED",
      tenantId: tenant.id,
    },
  });
  console.log(`[seed-demo] Admin : ${admin.email} (tenantId=${admin.tenantId})`);

  // 4. CompanyInfo demo (une seule fiche société par boutique)
  const existingInfo = await prisma.companyInfo.findFirst({ where: { tenantId: tenant.id } });
  if (!existingInfo) {
    await prisma.companyInfo.create({
      data: {
        shopName: "Demo Boutique",
        name: "Demo SARL",
        country: "France",
        email: "contact@demo.local",
        tenantId: tenant.id,
      },
    });
    console.log(`[seed-demo] CompanyInfo créé pour demo`);
  }

  // 5. 3 produits distincts avec préfixe DEMO_
  // On a besoin d'une catégorie partagée. On prend la 1re disponible.
  const anyCategory = await prisma.category.findFirst();
  if (!anyCategory) {
    console.error(`[seed-demo] Aucune catégorie disponible — impossible de créer des produits demo.`);
    process.exit(1);
  }
  for (const ref of ["DEMO-001", "DEMO-002", "DEMO-003"]) {
    await prisma.product.upsert({
      where: { reference: ref },
      update: {},
      create: {
        reference: ref,
        name: `Produit ${ref}`,
        description: `Produit test isolation multi-tenant — boutique Demo`,
        categoryId: anyCategory.id,
        tenantId: tenant.id,
      },
    });
  }
  console.log(`[seed-demo] 3 produits DEMO-001/002/003 créés`);

  // 6. Quelques SiteConfig distincts pour tester l'isolation
  const configs: Array<{ key: string; value: string }> = [
    { key: "shop_name", value: "Demo Boutique" },
    { key: "maintenance_mode", value: "false" },
    { key: "faire_api_key", value: "demo-fake-faire-key-XXXXX" },
    // Marque demo comme onboardé pour ne pas subir la redirection login
    // pendant les tests d'isolation cross-tenant.
    { key: "onboarding_completed_at", value: new Date().toISOString() },
  ];
  for (const c of configs) {
    // On a un souci : SiteConfig.key est unique global (PK = key seul).
    // On ne peut donc pas créer une 2e ligne pour la même key. On upsert
    // sans changer les valeurs beli-jolie existantes (skip si déjà présente).
    const existing = await prisma.siteConfig.findUnique({ where: { key: c.key } });
    if (!existing) {
      await prisma.siteConfig.create({
        data: { key: c.key, value: c.value, tenantId: tenant.id },
      });
      console.log(`[seed-demo] SiteConfig créé : ${c.key} → ${c.value}`);
    } else {
      console.log(`[seed-demo] SiteConfig ${c.key} déjà présent (tenantId=${existing.tenantId}) — skip (PK non composite)`);
    }
  }

  console.log(`\n[seed-demo] OK. Tenant demo prêt.`);
  const stats = {
    users: await prisma.user.count({ where: { tenantId: tenant.id } }),
    products: await prisma.product.count({ where: { tenantId: tenant.id } }),
    orders: await prisma.order.count({ where: { tenantId: tenant.id } }),
    companyInfo: await prisma.companyInfo.count({ where: { tenantId: tenant.id } }),
    siteConfig: await prisma.siteConfig.count({ where: { tenantId: tenant.id } }),
  };
  console.log(`[seed-demo] Stats demo :`, stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
