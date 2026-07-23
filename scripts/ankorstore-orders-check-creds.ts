import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true, isActive: true } });
  console.log("Tenants :");
  for (const t of tenants) console.log(`  - ${t.slug} (${t.name}) active=${t.isActive} id=${t.id}`);
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  console.log(`\nSiteConfig Ankorstore : ${rows.length} rows`);
  for (const r of rows) {
    const dec = decryptIfSensitive(r.key, r.value);
    const preview = dec ? `${dec.slice(0, 4)}…${dec.slice(-4)} (len=${dec.length})` : "<null>";
    console.log(`  - tenantId=${r.tenantId} key=${r.key} value=${preview}`);
  }
}

main().finally(async () => prisma.$disconnect());
