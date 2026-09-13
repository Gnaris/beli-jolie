/**
 * Backfill Collection.slug pour toutes les collections existantes.
 * Idempotent : ne touche que les collections dont slug est null.
 * Unicité gérée par tenant (contrainte @@unique([tenantId, slug])).
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { slugify } from "@/lib/storage";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });

  for (const tenant of tenants) {
    await tenantALS.run(tenant.id, async () => {
      const collections = await prisma.collection.findMany({
        where: { OR: [{ slug: null }, { slug: "" }] },
        select: { id: true, name: true, createdAt: true },
      });
      if (collections.length === 0) {
        console.log(`[${tenant.slug}] Rien à backfill.`);
        return;
      }

      const existingSlugs = new Set(
        (await prisma.collection.findMany({ select: { slug: true } }))
          .map((c) => c.slug)
          .filter((s): s is string => !!s),
      );

      for (const c of collections) {
        const base = slugify(c.name) || "collection";
        let candidate = base;
        let n = 2;
        while (existingSlugs.has(candidate)) {
          candidate = `${base}-${n}`;
          n++;
        }
        existingSlugs.add(candidate);
        await prisma.collection.update({
          where: { id: c.id },
          data: { slug: candidate },
        });
        console.log(`[${tenant.slug}] "${c.name}" → ${candidate}`);
      }
    });
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
