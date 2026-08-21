/**
 * Migration one-shot : retire les accents des noms de fichiers/dossiers
 * dans `public/uploads/{tenant}/produits/` + met à jour les paths BDD.
 *
 * Contexte (2026-08-21) : `slugify()` retire désormais les diacritiques
 * (`é` → `e`, `à` → `a`, `ç` → `c`…) pour éviter les URLs marketplaces
 * contenant des caractères percent-encoded non-ASCII (`%C3%A9`), rejetées
 * par Orderchamp comme « Invalid attachment » à la création produit.
 *
 * Ce script aligne les fichiers/dossiers existants qui portent encore
 * des accents dans leur nom :
 *   1. Scanne `public/uploads/{tenant}/produits/` récursivement.
 *   2. Pour chaque entrée dont le nom contient au moins un caractère
 *      non-ASCII → renomme sans accents.
 *   3. Met à jour `ProductColorImage.path` + `OrderItem.imagePath` dans
 *      la BDD pour chaque chemin réécrit.
 *
 * Usage :
 *   npx tsx scripts/migrate-strip-accents.ts             # dry-run
 *   npx tsx scripts/migrate-strip-accents.ts --apply     # écrit
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function hasAccents(input: string): boolean {
  return stripAccents(input) !== input;
}

interface Rename {
  oldDbPath: string;
  newDbPath: string;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
  });

  console.log(`\n${APPLY ? "🚀 APPLY" : "🔍 DRY-RUN"} — migration strip accents\n`);

  let totalRenames = 0;
  const swaps: Rename[] = [];

  for (const tenant of tenants) {
    const produitsRoot = path.join(process.cwd(), "public", "uploads", tenant.slug, "produits");
    if (!(await pathExists(produitsRoot))) {
      console.log(`[${tenant.slug}] ✓ Aucun dossier produits/ (skip)`);
      continue;
    }

    // 1) Renomme les DOSSIERS avec accent (couche 1 : sous-dossiers de produits/)
    const productDirs = await fs.readdir(produitsRoot, { withFileTypes: true });
    for (const entry of productDirs) {
      if (!entry.isDirectory()) continue;
      if (!hasAccents(entry.name)) continue;
      const newName = stripAccents(entry.name);
      const oldAbs = path.join(produitsRoot, entry.name);
      const newAbs = path.join(produitsRoot, newName);

      if (await pathExists(newAbs)) {
        console.log(`  ⚠️  collision dossier : ${entry.name} → ${newName} existe déjà (skip)`);
        continue;
      }
      console.log(`  📁 dossier : ${entry.name} → ${newName}`);
      if (APPLY) {
        await fs.rename(oldAbs, newAbs);
      }
    }

    // 2) Renomme les FICHIERS avec accent dans chaque dossier produit
    const productDirsAfter = await fs.readdir(produitsRoot, { withFileTypes: true });
    for (const dirEntry of productDirsAfter) {
      if (!dirEntry.isDirectory()) continue;
      const productDirAbs = path.join(produitsRoot, dirEntry.name);
      let files: import("node:fs").Dirent[];
      try {
        files = await fs.readdir(productDirAbs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile()) continue;
        if (!hasAccents(file.name)) continue;
        const newName = stripAccents(file.name);
        const oldAbs = path.join(productDirAbs, file.name);
        const newAbs = path.join(productDirAbs, newName);

        if (await pathExists(newAbs)) {
          console.log(`     ⚠️  collision : ${dirEntry.name}/${file.name} → ${newName} existe déjà (skip)`);
          continue;
        }
        const oldDbPath = `/uploads/${tenant.slug}/produits/${dirEntry.name}/${file.name}`;
        const newDbPath = `/uploads/${tenant.slug}/produits/${dirEntry.name}/${newName}`;
        console.log(`     ${oldDbPath}`);
        console.log(`  →  ${newDbPath}`);
        swaps.push({ oldDbPath, newDbPath });
        totalRenames += 1;
        if (APPLY) {
          await fs.rename(oldAbs, newAbs);
        }
      }
    }
  }

  // 3) Update BDD paths — 2 tables :
  //    - ProductColorImage.path : source de vérité pour l'affichage produit
  //    - OrderItem.imagePath : snapshot commande (peut contenir vieux paths)
  console.log(`\n📊 ${swaps.length} chemin(s) à mettre à jour en BDD.`);

  if (APPLY) {
    let updatedPci = 0;
    let updatedOi = 0;
    for (const swap of swaps) {
      const pciRes = await prisma.productColorImage.updateMany({
        where: { path: swap.oldDbPath },
        data: { path: swap.newDbPath },
      });
      updatedPci += pciRes.count;
      const oiRes = await prisma.orderItem.updateMany({
        where: { imagePath: swap.oldDbPath },
        data: { imagePath: swap.newDbPath },
      });
      updatedOi += oiRes.count;
    }
    console.log(`   ✓ ProductColorImage : ${updatedPci} lignes mises à jour.`);
    console.log(`   ✓ OrderItem        : ${updatedOi} lignes mises à jour.`);

    // Pose orderchampSyncRequired sur tous les produits dont les paths ont changé
    // pour forcer un re-push des URLs sans accent chez OC (et autres marketplaces).
    const affectedProductIds = new Set<string>();
    for (const swap of swaps) {
      const imgs = await prisma.productColorImage.findMany({
        where: { path: swap.newDbPath },
        select: { productId: true },
      });
      for (const img of imgs) affectedProductIds.add(img.productId);
    }
    if (affectedProductIds.size > 0) {
      await prisma.product.updateMany({
        where: { id: { in: [...affectedProductIds] } },
        data: {
          orderchampSyncRequired: true,
          ankorsSyncRequired: true,
          pfsSyncRequired: true,
          faireSyncRequired: true,
          efashionSyncRequired: true,
        },
      });
      console.log(`   ✓ ${affectedProductIds.size} produits flagués « Synchro nécessaire » sur toutes marketplaces.`);
    }
  }

  console.log(`\n${APPLY ? "✅ APPLY" : "🔍 DRY-RUN"} — ${totalRenames} fichier(s) renommé(s).`);
  if (!APPLY) console.log(`\nAjoute --apply pour écrire.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
