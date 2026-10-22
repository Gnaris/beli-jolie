/**
 * Rattrapage des miniatures (-md, -thumb) des images d'OrderItem copiées dans
 * `/uploads/{tenant}/commandes/{orderNumber}/`.
 *
 * Contexte : `copyOrderItemImageToOrderDir` ne copiait au départ que l'image
 * principale, pas ses variantes pré-générées. Depuis le fix crash iOS Safari
 * du 2026-10-22, la fiche commande affiche la variante `-thumb.webp` via
 * `getImageSrc(src, "thumb")`. Sans miniature sur le disque → 404 → vignette
 * blanche.
 *
 * Ce script régénère les miniatures manquantes pour toutes les commandes
 * déjà migrées (chemin contenant `/commandes/`). Sharp lit l'image principale
 * sur place et écrit les deux variantes à côté.
 *
 * Idempotent : si les miniatures existent déjà, on saute. Best-effort : si
 * l'image principale a disparu (purge disque), on log et on passe.
 *
 * Usage :
 *   npx tsx scripts/backfill-order-image-thumbnails.ts             # dry-run
 *   npx tsx scripts/backfill-order-image-thumbnails.ts --apply     # écrit
 */
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { keyFromDbPath, readFile, statFile, uploadFile } from "@/lib/storage";
import { getImagePaths } from "@/lib/image-utils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const SIZES = {
  medium: { width: 800, height: 800 },
  thumb: { width: 400, height: 400 },
} as const;

const WEBP_OPTS = { lossless: true, quality: 100, effort: 2 } as const;

async function main() {
  console.log(APPLY ? "MODE : APPLY (écriture miniatures)" : "MODE : dry-run (aucun write)");

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    orderBy: { slug: "asc" },
  });
  if (tenants.length === 0) {
    console.error("Aucun tenant actif trouvé. Abandon.");
    process.exit(1);
  }

  const totals = { generated: 0, alreadyOk: 0, missingSource: 0, skipped: 0, failed: 0 };

  for (const tenant of tenants) {
    console.log(`\n=== Tenant : ${tenant.slug} ===`);

    const items = await prisma.orderItem.findMany({
      where: {
        tenantId: tenant.id,
        imagePath: {
          contains: `/uploads/${tenant.slug}/commandes/`,
          endsWith: ".webp",
        },
      },
      select: {
        id: true,
        imagePath: true,
        order: { select: { orderNumber: true } },
      },
    });

    console.log(`  ${items.length} lignes à inspecter`);

    let generated = 0;
    let alreadyOk = 0;
    let missingSource = 0;
    let skipped = 0;
    let failed = 0;

    for (const it of items) {
      if (!it.imagePath) {
        skipped++;
        continue;
      }

      const paths = getImagePaths(it.imagePath);
      const largeKey = keyFromDbPath(paths.large);
      const mediumKey = keyFromDbPath(paths.medium);
      const thumbKey = keyFromDbPath(paths.thumb);

      try {
        const [largeStat, mediumStat, thumbStat] = await Promise.all([
          statFile(largeKey),
          statFile(mediumKey),
          statFile(thumbKey),
        ]);

        if (!largeStat) {
          missingSource++;
          continue;
        }
        if (mediumStat && thumbStat) {
          alreadyOk++;
          continue;
        }

        if (!APPLY) {
          generated++;
          continue;
        }

        const srcBuf = await readFile(largeKey);
        const oriented = sharp(srcBuf).rotate();

        const jobs: Promise<void>[] = [];
        if (!mediumStat) {
          jobs.push(
            oriented
              .clone()
              .resize(SIZES.medium.width, SIZES.medium.height, { fit: "inside", withoutEnlargement: true })
              .webp(WEBP_OPTS)
              .toBuffer()
              .then((buf) => uploadFile(mediumKey, buf)),
          );
        }
        if (!thumbStat) {
          jobs.push(
            oriented
              .clone()
              .resize(SIZES.thumb.width, SIZES.thumb.height, { fit: "inside", withoutEnlargement: true })
              .webp(WEBP_OPTS)
              .toBuffer()
              .then((buf) => uploadFile(thumbKey, buf)),
          );
        }
        await Promise.all(jobs);
        generated++;
      } catch (err) {
        failed++;
        console.error(`  [ÉCHEC] ${it.order?.orderNumber ?? "?"} · ${it.id}`, err);
      }
    }

    console.log(
      `  → Générées : ${generated} · Déjà OK : ${alreadyOk} · Source absente : ${missingSource} · Skippés : ${skipped} · Erreurs : ${failed}`,
    );
    totals.generated += generated;
    totals.alreadyOk += alreadyOk;
    totals.missingSource += missingSource;
    totals.skipped += skipped;
    totals.failed += failed;
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`  Miniatures générées : ${totals.generated}`);
  console.log(`  Déjà complètes : ${totals.alreadyOk}`);
  console.log(`  Source principale absente : ${totals.missingSource}`);
  console.log(`  Skippés : ${totals.skipped}`);
  console.log(`  Erreurs : ${totals.failed}`);

  if (!APPLY) {
    console.log(`\nDry-run terminé. Relance avec --apply pour écrire.`);
  }

  if (totals.failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("Erreur globale :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
