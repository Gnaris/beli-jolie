/**
 * Auto-mapping des bibliothèques BJ → eFashion en une passe.
 *
 * Pour chaque table (Category, ManufacturingCountry, Season, Composition,
 * Color), on regarde si une entrée BJ existe (par nom, case/accent insensibles)
 * dans la table `EFASHION_*_MAPPING` de `lib/efashion-library-mapping.ts`.
 * Si oui → on pose l'`efashion*Id` correspondant. Sinon → on log et on ignore.
 *
 * Pour les couleurs marquées `needsVendorAdd`, on appelle d'abord
 * `efashionAddCouleurToVendeur(id_vendeur, id_couleur)` pour les ajouter au
 * catalogue du vendeur avant de poser le mapping côté BJ.
 *
 * Ce script est idempotent : il SKIP toute entrée qui a déjà un mapping
 * eFashion (`!= null`). On peut donc le re-lancer sans risque.
 *
 * Usage VPS : `npx tsx scripts/efashion-automap-libraries.ts`
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe } from "@/lib/efashion-api";
import { efashionAddCouleurToVendeur } from "@/lib/efashion-api-write";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import {
  EFASHION_CATEGORY_MAPPING,
  EFASHION_SEASON_MAPPING,
  EFASHION_COMPOSITION_MAPPING,
  EFASHION_COLOR_MAPPING,
  findEfashionMapping,
} from "@/lib/efashion-library-mapping";

interface SectionReport {
  applied: number;
  skippedAlready: number;
  skippedNoMapping: number;
}

function newReport(): SectionReport {
  return { applied: 0, skippedAlready: 0, skippedNoMapping: 0 };
}

async function mapCategories(): Promise<SectionReport> {
  const r = newReport();
  const rows = await prisma.category.findMany({
    select: { id: true, name: true, efashionCategorieId: true },
    orderBy: { name: "asc" },
  });
  for (const row of rows) {
    if (row.efashionCategorieId !== null) {
      console.log(`  ⏭️  ${row.name} (déjà mappé : ${row.efashionCategorieId})`);
      r.skippedAlready += 1;
      continue;
    }
    const match = findEfashionMapping(row.name, EFASHION_CATEGORY_MAPPING);
    if (!match) {
      console.log(`  ⛔ ${row.name} — aucun mapping prévu (ignorée)`);
      r.skippedNoMapping += 1;
      continue;
    }
    await prisma.category.update({
      where: { id: row.id },
      data: { efashionCategorieId: match.efashionId },
    });
    console.log(`  ✅ ${row.name} → ${match.efashionId}`);
    r.applied += 1;
  }
  return r;
}

async function mapSeasons(): Promise<SectionReport> {
  const r = newReport();
  const rows = await prisma.season.findMany({
    select: { id: true, name: true, efashionCollectionId: true },
  });
  for (const row of rows) {
    if (row.efashionCollectionId !== null) {
      console.log(`  ⏭️  ${row.name} (déjà mappé : ${row.efashionCollectionId})`);
      r.skippedAlready += 1;
      continue;
    }
    const match = findEfashionMapping(row.name, EFASHION_SEASON_MAPPING);
    if (!match) {
      console.log(`  ⛔ ${row.name} — aucun mapping prévu`);
      r.skippedNoMapping += 1;
      continue;
    }
    await prisma.season.update({
      where: { id: row.id },
      data: { efashionCollectionId: match.efashionId },
    });
    console.log(`  ✅ ${row.name} → ${match.efashionId}`);
    r.applied += 1;
  }
  return r;
}

async function mapCompositions(): Promise<SectionReport> {
  const r = newReport();
  const rows = await prisma.composition.findMany({
    select: { id: true, name: true, efashionId: true },
    orderBy: { name: "asc" },
  });
  for (const row of rows) {
    if (row.efashionId !== null) {
      console.log(`  ⏭️  ${row.name} (déjà mappé : ${row.efashionId})`);
      r.skippedAlready += 1;
      continue;
    }
    const match = findEfashionMapping(row.name, EFASHION_COMPOSITION_MAPPING);
    if (!match) {
      console.log(`  ⛔ ${row.name} — aucun mapping prévu`);
      r.skippedNoMapping += 1;
      continue;
    }
    await prisma.composition.update({
      where: { id: row.id },
      data: { efashionId: match.efashionId },
    });
    console.log(`  ✅ ${row.name} → ${match.efashionId}`);
    r.applied += 1;
  }
  return r;
}

async function mapColors(vendorId: number): Promise<SectionReport> {
  const r = newReport();
  const rows = await prisma.color.findMany({
    select: { id: true, name: true, efashionColorId: true },
    orderBy: { name: "asc" },
  });
  for (const row of rows) {
    if (row.efashionColorId !== null) {
      console.log(`  ⏭️  ${row.name} (déjà mappé : ${row.efashionColorId})`);
      r.skippedAlready += 1;
      continue;
    }
    const match = findEfashionMapping(row.name, EFASHION_COLOR_MAPPING);
    if (!match) {
      console.log(`  ⛔ ${row.name} — aucun mapping prévu`);
      r.skippedNoMapping += 1;
      continue;
    }

    // Si la couleur n'est pas encore dans le catalogue vendeur, l'ajouter
    if (match.needsVendorAdd) {
      try {
        await efashionAddCouleurToVendeur({
          id_vendeur: vendorId,
          id_couleur: match.efashionId,
        });
        console.log(`     ↳ ajoutée au catalogue vendeur eFashion`);
      } catch (err) {
        // Cas typique : déjà ajoutée par un run précédent → eFashion peut
        // renvoyer une erreur, on tolère et on continue.
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`     ↳ (avertissement ajout catalogue vendeur : ${msg})`);
      }
    }

    await prisma.color.update({
      where: { id: row.id },
      data: { efashionColorId: match.efashionId },
    });
    console.log(
      `  ✅ ${row.name} → ${match.efashionId}${match.needsVendorAdd ? " (catalogue vendeur enrichi)" : ""}`,
    );
    r.applied += 1;
  }
  return r;
}

async function main() {
  const vendor = await efashionGetMe();
  console.log(`🔌 Connecté à eFashion : ${vendor.nomBoutique} (vendeur ${vendor.id_vendeur})\n`);

  console.log("═══ Catégories ═══");
  const catReport = await mapCategories();

  // Pays : plus de mapping BDD depuis 2026-07-21 — la liste et les refs
  // eFashion sont figées dans `lib/countries.ts`.

  console.log("\n═══ Saisons ═══");
  const seasonReport = await mapSeasons();

  console.log("\n═══ Matières ═══");
  const compReport = await mapCompositions();

  console.log("\n═══ Couleurs ═══");
  const colorReport = await mapColors(vendor.id_vendeur);

  // Invalider les caches pour que l'admin voie les nouveaux mappings de suite
  try {
    revalidateTag("efashion-annexes", "default");
    revalidateTag("categories", "default");
    revalidateTag("colors", "default");
    revalidateTag("compositions", "default");
    revalidateTag("seasons", "default");
  } catch {
    // En script hors next runtime, revalidateTag peut être no-op — pas grave.
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  RÉCAP");
  console.log("═══════════════════════════════════════════════════════");
  const sections: Array<[string, SectionReport]> = [
    ["Catégories", catReport],
    ["Saisons   ", seasonReport],
    ["Matières  ", compReport],
    ["Couleurs  ", colorReport],
  ];
  for (const [label, r] of sections) {
    console.log(
      `  ${label} : ${r.applied} appliqué(s), ${r.skippedAlready} déjà mappé(s), ${r.skippedNoMapping} sans mapping prévu`,
    );
  }
  console.log("═══════════════════════════════════════════════════════\n");

  const totalNoMapping =
    catReport.skippedNoMapping +
    seasonReport.skippedNoMapping +
    compReport.skippedNoMapping +
    colorReport.skippedNoMapping;
  if (totalNoMapping > 0) {
    console.log(
      `ℹ️  ${totalNoMapping} entrée(s) sans mapping prévu (typiquement les catégories vêtements à 0 produit) — à traiter à la main si vous y ajoutez des produits un jour.`,
    );
  }

  console.log(
    "\n👉 Vous pouvez maintenant relancer `npx tsx scripts/efashion-link-all.ts` pour lier vos produits.",
  );

  logger.info("[eFashion automap] done", {
    categories: catReport,
    countries: countryReport,
    seasons: seasonReport,
    compositions: compReport,
    colors: colorReport,
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur fatale :");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
