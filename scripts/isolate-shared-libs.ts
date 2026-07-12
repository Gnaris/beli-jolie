/**
 * scripts/isolate-shared-libs.ts
 *
 * Migre les libs partagées (Category, SubCategory, Color, Size, Composition,
 * Season, ManufacturingCountry, Tag) vers un modèle tenant-scoped :
 * - Chaque row est rattachée à un tenant.
 * - Si plusieurs tenants utilisent la même row, on la duplique (une par tenant)
 *   et on réattache les rows enfant (Product, ProductColor, etc) au bon clone.
 *
 * Idempotent : ne touche pas aux rows déjà scopées.
 *
 * À lancer sur prod via `MULTI_TENANT_SCOPE=off npx tsx scripts/isolate-shared-libs.ts`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type TenantIds = Record<string, string>;

/**
 * Pour un modèle donné, retourne la map { libRowId → Set<tenantId qui utilise cette row> }.
 * fkTable = table qui relie la lib au tenant (ex: Product pour Category).
 * fkColumn = colonne dans fkTable qui pointe vers libRowId (ex: categoryId).
 */
async function usageByTenant(
  fkTable: string,
  fkColumn: string,
  customQuery?: string,
): Promise<Map<string, Set<string>>> {
  const sql = customQuery ?? `SELECT DISTINCT \`${fkColumn}\` AS libId, tenantId
     FROM \`${fkTable}\`
     WHERE \`${fkColumn}\` IS NOT NULL AND tenantId IS NOT NULL`;
  const rows = await prisma.$queryRawUnsafe<Array<{ libId: string; tenantId: string }>>(sql);
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.libId)) map.set(r.libId, new Set());
    map.get(r.libId)!.add(r.tenantId);
  }
  return map;
}

/**
 * Assigne tenantId aux rows non-utilisées : par défaut beli-jolie
 * (rows orphelines créées historiquement).
 */
async function assignOrphansTo(table: string, tenantId: string): Promise<number> {
  const res = await prisma.$executeRawUnsafe(
    `UPDATE \`${table}\` SET tenantId = ? WHERE tenantId IS NULL`,
    tenantId,
  );
  return Number(res);
}

/**
 * Duplique une row lib pour un tenant donné (nouvel id, même contenu).
 * Copie AUTOMATIQUEMENT toutes les colonnes du schéma sauf id/tenantId.
 * Suffixe les colonnes uniques (name, slug, isoCode, pfsColorRef, etc)
 * pour éviter les collisions avant passage en @@unique composite.
 */
async function cloneLibRow(
  table: string,
  originalId: string,
  targetTenantId: string,
  newIdSuffix: string,
  uniqueTextCols: string[],
): Promise<string> {
  const original = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM \`${table}\` WHERE id = ?`,
    originalId,
  );
  if (original.length === 0) throw new Error(`${table} ${originalId} introuvable`);
  const row = { ...original[0] };
  const newId = `${originalId}${newIdSuffix}`;
  row.id = newId;
  row.tenantId = targetTenantId;
  for (const c of uniqueTextCols) {
    if (row[c] != null && typeof row[c] === "string") {
      row[c] = `${row[c]}${newIdSuffix}`;
    }
  }
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(",");
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(",")}) VALUES (${placeholders})`,
    ...cols.map(c => row[c]),
  );
  return newId;
}

async function migrate(
  libTable: string,
  fkTable: string,
  fkColumn: string,
  uniqueTextCols: string[],
  tenantIds: TenantIds,
  customUsageQuery?: string,
  customReattachTemplate?: (newId: string, oldId: string, issymaTid: string) => string,
): Promise<{ soleUse: number; duplicated: number; orphans: number }> {
  console.log(`\n=== ${libTable} → ${fkTable}.${fkColumn} ===`);
  const usage = await usageByTenant(fkTable, fkColumn, customUsageQuery);

  let soleUse = 0;
  let duplicated = 0;
  const [bjTid, issymaTid] = Object.values(tenantIds);

  for (const [libId, tenantsUsingIt] of usage.entries()) {
    if (tenantsUsingIt.size === 1) {
      const tid = [...tenantsUsingIt][0];
      await prisma.$executeRawUnsafe(
        `UPDATE \`${libTable}\` SET tenantId = ? WHERE id = ? AND tenantId IS NULL`,
        tid,
        libId,
      );
      soleUse++;
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE \`${libTable}\` SET tenantId = ? WHERE id = ?`,
        bjTid,
        libId,
      );
      const newId = await cloneLibRow(libTable, libId, issymaTid, "-issy", uniqueTextCols);
      if (customReattachTemplate) {
        await prisma.$executeRawUnsafe(customReattachTemplate(newId, libId, issymaTid));
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE \`${fkTable}\` SET \`${fkColumn}\` = ? WHERE \`${fkColumn}\` = ? AND tenantId = ?`,
          newId,
          libId,
          issymaTid,
        );
      }
      duplicated++;
    }
  }

  const orphans = await assignOrphansTo(libTable, bjTid);
  console.log(`  → utilisé par 1 tenant : ${soleUse}`);
  console.log(`  → dupliqué (2 tenants) : ${duplicated}`);
  console.log(`  → orphelins → BJ       : ${orphans}`);
  return { soleUse, duplicated, orphans };
}

async function main() {
  const bj = await prisma.tenant.findUnique({ where: { slug: "beliandjolie" } });
  const issyma = await prisma.tenant.findUnique({ where: { slug: "issyma" } });
  if (!bj || !issyma) throw new Error("Tenants beliandjolie/issyma introuvables");
  const tenantIds: TenantIds = { beliandjolie: bj.id, issyma: issyma.id };

  console.log(`Tenants: beli-jolie=${bj.id}, issyma=${issyma.id}`);

  // Colonnes uniques à suffixer lors du clone (pour éviter collision avant
  // le passage en @@unique composite).
  const nameSlug = ["name", "slug"];
  const nameOnly = ["name"];
  const nameIso = ["name", "isoCode", "pfsCountryRef"];
  const nameColor = ["name", "pfsColorRef"];

  await migrate("Category", "Product", "categoryId", nameSlug, tenantIds);

  // SubCategory : la table de jonction _ProductSubCategories n'a pas tenantId.
  // On détecte le tenant via join avec Product (A=subCatId, B=productId).
  await migrate(
    "SubCategory",
    "_ProductSubCategories",
    "A",
    nameSlug,
    tenantIds,
    `SELECT DISTINCT psc.A AS libId, p.tenantId
     FROM _ProductSubCategories psc
     JOIN Product p ON p.id = psc.B
     WHERE p.tenantId IS NOT NULL`,
    (newId, oldId, issymaTid) =>
      `UPDATE _ProductSubCategories psc
       JOIN Product p ON p.id = psc.B
       SET psc.A = '${newId}'
       WHERE psc.A = '${oldId}' AND p.tenantId = '${issymaTid}'`,
  );

  await migrate("Color", "ProductColor", "colorId", nameColor, tenantIds);
  await migrate("Size", "VariantSize", "sizeId", nameOnly, tenantIds);
  await migrate("Composition", "ProductComposition", "compositionId", nameOnly, tenantIds);
  await migrate("Season", "Product", "seasonId", nameOnly, tenantIds);
  await migrate("ManufacturingCountry", "Product", "manufacturingCountryId", nameIso, tenantIds);
  await migrate("Tag", "ProductTag", "tagId", nameOnly, tenantIds);

  console.log("\n🎉 Migration shared libs terminée.");
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
