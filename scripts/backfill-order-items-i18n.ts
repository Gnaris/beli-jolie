/**
 * Backfill du snapshot `OrderItem.productNameI18n` pour les commandes
 * antérieures à la feature. Lookup des `ProductTranslation` existantes par
 * `productRef` et pose le JSON { en, de, it, es } sur chaque ligne.
 *
 * À lancer après `prisma db push` suite à l'ajout de la colonne
 * `productNameI18n`. Idempotent : réécrase systématiquement avec la version
 * la plus récente des traductions, utile si de nouvelles traductions ont été
 * ajoutées en BDD depuis la commande.
 *
 * Usage :
 *   npx tsx scripts/backfill-order-items-i18n.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  // Charger toutes les ProductTranslation disponibles, groupées par référence
  // produit (via le join Product.reference).
  const products = await prisma.product.findMany({
    select: {
      reference: true,
      translations: { select: { locale: true, name: true } },
    },
  });

  const byRef = new Map<string, Record<string, string>>();
  for (const p of products) {
    const entry: Record<string, string> = {};
    for (const t of p.translations) {
      const name = t.name?.trim();
      if (name) entry[t.locale] = name;
    }
    if (Object.keys(entry).length > 0) byRef.set(p.reference, entry);
  }

  // Récupérer tous les OrderItems — on peut backfill en masse, c'est léger.
  const items = await prisma.orderItem.findMany({
    select: { id: true, productRef: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const item of items) {
    const i18n = byRef.get(item.productRef);
    if (!i18n) {
      skipped += 1;
      continue;
    }
    await prisma.orderItem.update({
      where: { id: item.id },
      // Prisma accepte le JSON directement sur un champ Json? ; en Prisma 5.22,
      // on peut passer l'objet tel quel.
      data: { productNameI18n: i18n },
    });
    updated += 1;
  }

  console.log(`Backfill terminé : ${updated} OrderItem mis à jour, ${skipped} sans traduction disponible.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
