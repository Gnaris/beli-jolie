/**
 * One-shot local: supprime N produits au hasard sur le tenant courant.
 * Reproduit la logique de deleteProduct() : archive si commandé, sinon
 * delete complet (variantes, cartItems, images, fichiers, dossier).
 *
 * Usage: npx tsx scripts/wipe-random-products.ts <tenantSlug> <count>
 *   ex:  npx tsx scripts/wipe-random-products.ts beli-jolie 480
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import {
  deleteFiles,
  deleteDirectory,
  keyFromDbPath,
  productImageDir,
} from "@/lib/storage";
import { getImagePaths } from "@/lib/image-utils";

async function main() {
  const slug = process.argv[2];
  const count = Number(process.argv[3]);
  if (!slug || !Number.isFinite(count) || count <= 0) {
    console.error("Usage: npx tsx scripts/wipe-random-products.ts <tenantSlug> <count>");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" introuvable`);
    process.exit(1);
  }

  await tenantALS.run(tenant.id, async () => {
    const candidates = await prisma.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, reference: true },
    });
    console.log(`Candidats (non-ARCHIVED): ${candidates.length}`);
    if (candidates.length < count) {
      console.error(`Pas assez de candidats (${candidates.length} < ${count}).`);
      process.exit(1);
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picked = candidates.slice(0, count);

    let deleted = 0;
    let archived = 0;
    let failed = 0;

    for (const [idx, p] of picked.entries()) {
      try {
        const orderCount = await prisma.orderItem.count({
          where: { productRef: p.reference },
        });

        if (orderCount > 0) {
          await prisma.product.update({
            where: { id: p.id },
            data: { status: "ARCHIVED" },
          });
          archived++;
        } else {
          const variantIds = await prisma.productColor.findMany({
            where: { productId: p.id },
            select: { id: true },
          });
          if (variantIds.length > 0) {
            await prisma.cartItem.deleteMany({
              where: { variantId: { in: variantIds.map((v) => v.id) } },
            });
          }

          const images = await prisma.productColorImage.findMany({
            where: { productId: p.id },
            select: { path: true },
          });
          if (images.length > 0) {
            const keys = images.flatMap(({ path }) => {
              const paths = getImagePaths(path);
              return [paths.large, paths.medium, paths.thumb].map(keyFromDbPath);
            });
            try {
              await deleteFiles(keys);
            } catch {}
          }
          try {
            await deleteDirectory(productImageDir(p.reference, tenant.slug));
          } catch {}

          await prisma.product.delete({ where: { id: p.id } });
          deleted++;
        }
      } catch (err) {
        failed++;
        console.error(`[${idx + 1}/${picked.length}] KO ${p.reference}:`, err);
      }

      if ((idx + 1) % 50 === 0) {
        console.log(`… ${idx + 1}/${picked.length} traités`);
      }
    }

    console.log(`\nFini: supprimés=${deleted} archivés=${archived} échecs=${failed}`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
