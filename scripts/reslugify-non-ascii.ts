/**
 * Ré-slugifie les Category / SubCategory / Collection dont le slug contient
 * des caractères non-ASCII (apostrophes typographiques `’`, em/en dashes `—`,
 * lettres accentuées, etc.).
 *
 * Contexte : la fonction `slugify()` a été durcie pour ne produire que du
 * `[a-z0-9-_]`. Ancien comportement laissait passer `’` et `—`, ce qui rendait
 * les URLs publiques `/collections/eclat-d’automne-…` fragiles (cache ISR
 * Next.js 16 servait des 404, Google indexait mal, partages sur les réseaux
 * cassaient l'URL).
 *
 * Dry-run par défaut. Passer `--apply` pour écrire en BDD.
 *
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/reslugify-non-ascii.ts
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/reslugify-non-ascii.ts --apply
 *
 * Le flag `MULTI_TENANT_SCOPE=off` désactive l'extension Prisma qui scope
 * automatiquement par tenant : sans lui, un script CLI (hors requête) ne voit
 * QUE ses lignes propres et le backfill est partiel.
 */
import { PrismaClient } from "@prisma/client";
import { slugify } from "../lib/storage";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface Row {
  id: string;
  name: string;
  slug: string | null;
  tenantId: string | null;
}

const NON_ASCII = /[^\x00-\x7F]/;

async function pickUniqueSlug(
  model: "category" | "subCategory" | "collection",
  base: string,
  tenantId: string | null,
  selfId: string,
): Promise<string> {
  let candidate = base || "sans-nom";
  let n = 2;
  for (let i = 0; i < 50; i++) {
    // Scope par tenant si le tenantId est connu (unicité effective en BDD).
    // Chaque modèle a la même contrainte @@unique([tenantId, slug]).
    const where: Record<string, unknown> = { slug: candidate, NOT: { id: selfId } };
    if (tenantId) where.tenantId = tenantId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (prisma as any)[model].findFirst({ where, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${base}-${n}`;
    n++;
  }
  return `${base}-${Date.now()}`;
}

async function processModel(
  model: "category" | "subCategory" | "collection",
  label: string,
): Promise<{ scanned: number; changed: number; conflicts: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Row[] = await (prisma as any)[model].findMany({
    select: { id: true, name: true, slug: true, tenantId: true },
  });
  let changed = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (!row.slug) continue;
    if (!NON_ASCII.test(row.slug)) continue;
    const base = slugify(row.name);
    const nextSlug = await pickUniqueSlug(model, base, row.tenantId ?? null, row.id);
    console.log(`  [${label}] ${row.id} tenant=${row.tenantId ?? "-"}`);
    console.log(`    name    : ${row.name}`);
    console.log(`    ancien  : ${row.slug}`);
    console.log(`    nouveau : ${nextSlug}`);
    if (nextSlug !== base && nextSlug !== `${base}-${row.id.slice(-4)}`) {
      // suffixe -N ajouté → collision avec un slug existant sur le même tenant
      if (nextSlug !== base) conflicts++;
    }
    if (APPLY) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any)[model].update({ where: { id: row.id }, data: { slug: nextSlug } });
    }
    changed++;
  }
  return { scanned: rows.length, changed, conflicts };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (écriture BDD)" : "DRY-RUN (aucune écriture)"}`);
  console.log("");

  const cat = await processModel("category", "Category");
  console.log("");
  const sub = await processModel("subCategory", "SubCategory");
  console.log("");
  const col = await processModel("collection", "Collection");

  console.log("");
  console.log("=== Bilan ===");
  console.log(`Category    : ${cat.changed}/${cat.scanned} à ré-slugifier`);
  console.log(`SubCategory : ${sub.changed}/${sub.scanned} à ré-slugifier`);
  console.log(`Collection  : ${col.changed}/${col.scanned} à ré-slugifier`);
  if (!APPLY) console.log("\nRelancer avec --apply pour écrire en BDD.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
