/**
 * Backfill des miniatures de commandes.
 *
 * Contexte : historiquement, `OrderItem.imagePath` pointe vers l'image de la
 * variante d'origine (`/uploads/{tenant}/produits/{ref}/...`). Si l'admin
 * supprime cette variante plus tard, la vignette disparaît de la commande.
 *
 * Depuis 2026-09-18, chaque nouvelle commande copie sa miniature dans un
 * dossier propre à la commande (`/uploads/{tenant}/commandes/{orderNumber}/`).
 * Ce script rattrape TOUTES les commandes antérieures, pour les 2 tenants
 * (beliandjolie + issyma).
 *
 * Idempotent : re-run OK, on ne touche pas aux OrderItems déjà migrés
 * (chemin contenant déjà `/commandes/`).
 *
 * Best-effort : si l'image source a déjà disparu du disque (variante
 * supprimée avant le backfill), on log et on saute — la ligne conserve son
 * ancien chemin (vignette placeholder), toutes les infos texte restent OK.
 *
 * Usage :
 *   npx tsx scripts/backfill-order-images.ts             # dry-run, aucun write
 *   npx tsx scripts/backfill-order-images.ts --apply     # copie + update BDD
 */
import { PrismaClient } from "@prisma/client";
import { copyOrderItemImageToOrderDir } from "@/lib/order-item-image-copy";
import { keyFromDbPath, statFile } from "@/lib/storage";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "MODE : APPLY (écriture disque + BDD)" : "MODE : dry-run (aucun write)");

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    orderBy: { slug: "asc" },
  });
  if (tenants.length === 0) {
    console.error("Aucun tenant actif trouvé. Abandon.");
    process.exit(1);
  }

  const totals = { ok: 0, missing: 0, skipped: 0, failed: 0 };

  for (const tenant of tenants) {
    console.log(`\n=== Tenant : ${tenant.slug} (${tenant.id}) ===`);

    const items = await prisma.orderItem.findMany({
      where: {
        tenantId: tenant.id,
        imagePath: { not: null },
        // Idempotence : on ne re-traite pas ce qui pointe déjà vers commandes/.
        NOT: { imagePath: { contains: `/uploads/${tenant.slug}/commandes/` } },
      },
      select: {
        id: true,
        imagePath: true,
        order: { select: { orderNumber: true } },
      },
    });

    console.log(`  ${items.length} lignes à traiter`);

    let ok = 0;
    let missing = 0;
    let skipped = 0;
    let failed = 0;

    for (const it of items) {
      if (!it.imagePath || !it.order?.orderNumber) {
        skipped++;
        continue;
      }

      try {
        if (!APPLY) {
          const stat = await statFile(keyFromDbPath(it.imagePath));
          if (!stat) {
            missing++;
            console.warn(`  [MANQUANT] ${it.order.orderNumber} · ${it.id} · ${it.imagePath}`);
          } else {
            ok++;
          }
          continue;
        }

        const newPath = await copyOrderItemImageToOrderDir({
          sourceDbPath: it.imagePath,
          orderNumber: it.order.orderNumber,
          orderItemId: it.id,
          tenantSlug: tenant.slug,
        });

        if (!newPath) {
          missing++;
          console.warn(`  [MANQUANT] ${it.order.orderNumber} · ${it.id} · ${it.imagePath}`);
          continue;
        }

        await prisma.orderItem.update({
          where: { id: it.id },
          data:  { imagePath: newPath },
        });
        ok++;
      } catch (err) {
        failed++;
        console.error(`  [ÉCHEC] ${it.order?.orderNumber ?? "?"} · ${it.id}`, err);
      }
    }

    console.log(`  → Copiés : ${ok} · Sources manquantes : ${missing} · Skippés : ${skipped} · Erreurs : ${failed}`);
    totals.ok += ok;
    totals.missing += missing;
    totals.skipped += skipped;
    totals.failed += failed;
  }

  console.log(`\n=== TOTAL ===`);
  console.log(`  Copiés : ${totals.ok}`);
  console.log(`  Sources manquantes (variante déjà supprimée) : ${totals.missing}`);
  console.log(`  Skippés (imagePath ou orderNumber null) : ${totals.skipped}`);
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
