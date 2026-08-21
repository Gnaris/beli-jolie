/**
 * Migration one-shot : produits dont la référence contient `(` ou `)`.
 *
 * Contexte (2026-08-21) : `slugify()` transforme désormais `(N)` → `_N` pour
 * éviter les parenthèses dans les URLs marketplaces (Orderchamp rejette
 * `Invalid attachment` sur `A2251(2)`). Ce script aligne les données
 * existantes :
 *   1. Renomme le dossier physique `public/uploads/{tenant}/produits/{oldSlug}`
 *      → `.../{newSlug}` (ex `a2251(2)` → `a2251_2`).
 *   2. Renomme chaque fichier dedans (préfixe `{oldSlug}-` → `{newSlug}-`).
 *   3. Met à jour `ProductColorImage.path` en BDD pour chaque path modifié.
 *   4. Met à jour `OrderItem.imagePath` (snapshot commande) pareillement.
 *
 * La référence produit (`Product.reference`) N'EST PAS modifiée — elle reste
 * `A2251(2)` en BDD, seul le chemin fichier change.
 *
 * Usage :
 *   npx tsx scripts/migrate-references-with-parens.ts             # dry-run
 *   npx tsx scripts/migrate-references-with-parens.ts --apply     # écrit
 *   npx tsx scripts/migrate-references-with-parens.ts --tenant=beliandjolie --apply
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TENANT_ARG = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];

/**
 * Reproduction de l'ANCIEN slugify (sans transformation des parenthèses).
 * Nécessaire pour calculer le nom de dossier historique sur disque.
 */
function oldSlugify(input: string): string {
  if (input == null) return "sans-nom";
  const stripped = String(input)
    .normalize("NFC")
    .toLowerCase()
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return stripped || "sans-nom";
}

/** NOUVEAU slugify — copie de lib/storage.ts pour être auto-portant. */
function newSlugify(input: string): string {
  if (input == null) return "sans-nom";
  const stripped = String(input)
    .normalize("NFC")
    .toLowerCase()
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
    .replace(/\((\d+)\)/g, "_$1")
    .replace(/[()]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return stripped || "sans-nom";
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

async function renameFolderAndFiles(
  oldDir: string,
  newDir: string,
  oldFilePrefix: string,
  newFilePrefix: string,
): Promise<Rename[]> {
  const oldAbs = path.join(process.cwd(), "public", oldDir);
  const newAbs = path.join(process.cwd(), "public", newDir);

  if (!(await pathExists(oldAbs))) {
    console.log(`  ⚠️  dossier absent sur disque : ${oldDir} (skip renommage physique)`);
    return [];
  }
  if (await pathExists(newAbs)) {
    console.log(`  ⚠️  destination existe déjà : ${newDir} (skip renommage physique — collision)`);
    return [];
  }

  const swaps: Rename[] = [];

  if (APPLY) {
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs);
  }

  const entries = APPLY
    ? await fs.readdir(newAbs, { withFileTypes: true })
    : await fs.readdir(oldAbs, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(oldFilePrefix)) continue;
    const newName = newFilePrefix + entry.name.slice(oldFilePrefix.length);
    if (APPLY) {
      await fs.rename(path.join(newAbs, entry.name), path.join(newAbs, newName));
    }
    swaps.push({
      oldDbPath: `/${oldDir}/${entry.name}`,
      newDbPath: `/${newDir}/${newName}`,
    });
  }

  return swaps;
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: TENANT_ARG ? { slug: TENANT_ARG } : undefined,
    select: { id: true, slug: true, name: true },
  });

  if (tenants.length === 0) {
    console.log("Aucun tenant trouvé.");
    return;
  }

  console.log(`\n${APPLY ? "🚀 APPLY" : "🔍 DRY-RUN"} — migration références avec parenthèses\n`);

  let totalProducts = 0;
  let totalSwaps = 0;

  for (const tenant of tenants) {
    const products = await prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        OR: [{ reference: { contains: "(" } }, { reference: { contains: ")" } }],
      },
      select: { id: true, reference: true },
      orderBy: { reference: "asc" },
    });

    if (products.length === 0) {
      console.log(`\n[${tenant.slug}] ✓ Aucun produit avec parenthèses.`);
      continue;
    }

    console.log(`\n[${tenant.slug}] ${products.length} produit(s) à migrer :`);

    for (const p of products) {
      const oldSlug = oldSlugify(p.reference);
      const newSlug = newSlugify(p.reference);
      if (oldSlug === newSlug) {
        console.log(`  · ${p.reference} → déjà propre (skip)`);
        continue;
      }

      totalProducts += 1;
      const oldDir = `uploads/${tenant.slug}/produits/${oldSlug}`;
      const newDir = `uploads/${tenant.slug}/produits/${newSlug}`;
      console.log(`  · ${p.reference}`);
      console.log(`     ${oldDir}`);
      console.log(`  →  ${newDir}`);

      const swaps = await renameFolderAndFiles(oldDir, newDir, `${oldSlug}-`, `${newSlug}-`);

      if (swaps.length === 0) {
        console.log(`     (aucun fichier à renommer)`);
        continue;
      }

      totalSwaps += swaps.length;

      for (const swap of swaps) {
        console.log(`     ${swap.oldDbPath}`);
        console.log(`  →  ${swap.newDbPath}`);

        if (APPLY) {
          await prisma.productColorImage.updateMany({
            where: { tenantId: tenant.id, path: swap.oldDbPath },
            data: { path: swap.newDbPath },
          });
          await prisma.orderItem.updateMany({
            where: { tenantId: tenant.id, imagePath: swap.oldDbPath },
            data: { imagePath: swap.newDbPath },
          });
        }
      }

      if (APPLY) {
        // Pose orderchampSyncRequired=true pour que le produit soit re-synchro
        // et que les nouvelles URLs remontent chez Orderchamp.
        await prisma.product.update({
          where: { id: p.id },
          data: {
            orderchampSyncRequired: true,
            ankorsSyncRequired: true,
            pfsSyncRequired: true,
            faireSyncRequired: true,
            efashionSyncRequired: true,
          },
        });
      }
    }
  }

  console.log(
    `\n${APPLY ? "✅ APPLY" : "🔍 DRY-RUN"} — ${totalProducts} produit(s) traité(s), ${totalSwaps} chemin(s) fichier(s) à modifier.`,
  );
  if (!APPLY) {
    console.log(`\nAjoute --apply pour écrire.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
