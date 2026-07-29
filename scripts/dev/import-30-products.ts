/**
 * IMPORT-30-PRODUCTS
 *
 * A executer EN LOCAL. Lit `tmp-dump/dump.json` + `tmp-dump/images.tar.gz`
 * produits par `dump-30-products.ts` (VPS), puis :
 *
 *   1. Wipe complet du local (via `purgeDatabase` de scripts/wipe-data.ts,
 *      identique a `npx tsx scripts/wipe-data.ts` : garde ADMIN + SiteConfig
 *      + CompanyInfo + Legal). Vide aussi les dossiers uploads.
 *   2. Reinsere les referentiels (Category/SubCategory/Color/Size/Composition/
 *      Tag/Season/HsCode + leurs Translation) avec les IDs de prod pour
 *      preserver les FK, mais remappe tenantId vers le tenant local beli-jolie.
 *   3. Reinsere les 30 produits + toutes leurs relations avec la meme
 *      strategie (garde les IDs source, remappe tenantId, rewrite les paths
 *      d'images `beliandjolie` -> `beli-jolie`).
 *   4. Extrait le tar images et deplace le contenu vers
 *      `public/uploads/beli-jolie/produits/`.
 *
 * Usage :
 *   npx tsx scripts/dev/import-30-products.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { purgeDatabase, purgeUploads, type PrismaLike } from "../wipe-data";

const runFile = promisify(execFile);

const LOCAL_TENANT_SLUG = "beli-jolie";
const SOURCE_TENANT_SLUG = "beliandjolie";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DUMP_JSON = path.join(PROJECT_ROOT, "tmp-dump", "dump.json");
const IMAGES_TAR = path.join(PROJECT_ROOT, "tmp-dump", "images.tar.gz");
const IMAGES_STAGING = path.join(PROJECT_ROOT, "tmp-dump", "images-staging");
const LOCAL_UPLOAD_TARGET = path.join(
  PROJECT_ROOT,
  "public",
  "uploads",
  LOCAL_TENANT_SLUG,
  "produits",
);

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function rewriteImagePath(p: string | null | undefined): string | null | undefined {
  if (!p) return p;
  return p.split(`/uploads/${SOURCE_TENANT_SLUG}/`).join(`/uploads/${LOCAL_TENANT_SLUG}/`);
}

function toDate(v: any): Date | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  return new Date(v);
}

// ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[import] Chargement du dump: ${DUMP_JSON}`);
  const raw = await fs.readFile(DUMP_JSON, "utf8");
  const payload = JSON.parse(raw) as any;

  const prisma = new PrismaClient();

  // 1. Trouver / creer le tenant local
  const localTenant = await prisma.tenant.findUnique({ where: { slug: LOCAL_TENANT_SLUG } });
  if (!localTenant) {
    throw new Error(
      `Tenant local "${LOCAL_TENANT_SLUG}" introuvable. Lancer scripts/seed-default-tenant.ts d'abord.`,
    );
  }
  console.log(`[import] Tenant local: ${localTenant.slug} (${localTenant.id})`);

  // 2. Wipe complet (DB + uploads)
  console.log(`[import] --- Wipe base de donnees ---`);
  await purgeDatabase(prisma as unknown as PrismaLike, (m) => console.log(m));

  console.log(`[import] --- Wipe uploads ---`);
  await purgeUploads({ cwd: PROJECT_ROOT, log: (m) => console.log(m) });

  // 3. Re-inserer referentiels (IDs source, tenantId local)
  const T = localTenant.id;
  const R = payload.referentials;

  console.log(`[import] --- Insert referentiels ---`);

  // HsCode : pas de tenant
  for (const h of R.hsCodes ?? []) {
    await prisma.hsCode.upsert({
      where: { id: h.id },
      update: {},
      create: {
        id: h.id,
        code: h.code,
        label: h.label,
        position: h.position ?? 0,
        createdAt: toDate(h.createdAt) ?? undefined,
      },
    });
  }
  console.log(`  HsCode        ${R.hsCodes?.length ?? 0}`);

  // Category (independant, translations en 2e passe pour eviter FK)
  for (const c of R.categories ?? []) {
    await prisma.category.create({
      data: {
        id: c.id,
        name: c.name,
        slug: c.slug,
        pfsCategoryId: c.pfsCategoryId,
        pfsGender: c.pfsGender,
        pfsFamilyId: c.pfsFamilyId,
        pfsFamilyName: c.pfsFamilyName,
        pfsCategoryName: c.pfsCategoryName,
        efashionCategorieId: c.efashionCategorieId,
        faireTaxonomyId: c.faireTaxonomyId,
        faireHsCode: c.faireHsCode,
        position: c.position ?? 0,
        createdAt: toDate(c.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (c.translations ?? []).map((t: any) => ({
            id: t.id,
            locale: t.locale,
            name: t.name,
            createdAt: toDate(t.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  Category      ${R.categories?.length ?? 0}`);

  // SubCategory (categoryId requis)
  for (const s of R.subCategories ?? []) {
    await prisma.subCategory.create({
      data: {
        id: s.id,
        name: s.name,
        slug: s.slug,
        categoryId: s.categoryId,
        position: s.position ?? undefined,
        createdAt: toDate(s.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (s.translations ?? []).map((t: any) => ({
            id: t.id,
            locale: t.locale,
            name: t.name,
            createdAt: toDate(t.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  SubCategory   ${R.subCategories?.length ?? 0}`);

  // Color
  for (const c of R.colors ?? []) {
    await prisma.color.create({
      data: {
        id: c.id,
        name: c.name,
        hex: c.hex,
        patternImage: c.patternImage,
        pfsColorRef: c.pfsColorRef,
        efashionColorId: c.efashionColorId,
        position: c.position ?? 0,
        createdAt: toDate(c.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (c.translations ?? []).map((t: any) => ({
            id: t.id,
            locale: t.locale,
            name: t.name,
            createdAt: toDate(t.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  Color         ${R.colors?.length ?? 0}`);

  // Size (pas de translations)
  for (const s of R.sizes ?? []) {
    await prisma.size.create({
      data: {
        id: s.id,
        name: s.name,
        position: s.position ?? 0,
        pfsSizeRef: s.pfsSizeRef,
        createdAt: toDate(s.createdAt) ?? undefined,
        updatedAt: toDate(s.updatedAt) ?? undefined,
        tenantId: T,
      },
    });
  }
  console.log(`  Size          ${R.sizes?.length ?? 0}`);

  // Composition
  for (const c of R.compositions ?? []) {
    await prisma.composition.create({
      data: {
        id: c.id,
        name: c.name,
        pfsCompositionRef: c.pfsCompositionRef,
        efashionId: c.efashionId,
        faireMaterialLabel: c.faireMaterialLabel,
        position: c.position ?? 0,
        createdAt: toDate(c.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (c.translations ?? []).map((t: any) => ({
            id: t.id,
            locale: t.locale,
            name: t.name,
            createdAt: toDate(t.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  Composition   ${R.compositions?.length ?? 0}`);

  // Tag
  for (const t of R.tags ?? []) {
    await prisma.tag.create({
      data: {
        id: t.id,
        name: t.name,
        createdAt: toDate(t.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (t.translations ?? []).map((tr: any) => ({
            id: tr.id,
            locale: tr.locale,
            name: tr.name,
            createdAt: toDate(tr.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  Tag           ${R.tags?.length ?? 0}`);

  // Season
  for (const s of R.seasons ?? []) {
    await prisma.season.create({
      data: {
        id: s.id,
        name: s.name,
        pfsRef: s.pfsRef,
        efashionCollectionId: s.efashionCollectionId,
        position: s.position ?? 0,
        createdAt: toDate(s.createdAt) ?? undefined,
        tenantId: T,
        translations: {
          create: (s.translations ?? []).map((tr: any) => ({
            id: tr.id,
            locale: tr.locale,
            name: tr.name,
            createdAt: toDate(tr.createdAt) ?? undefined,
          })),
        },
      },
    });
  }
  console.log(`  Season        ${R.seasons?.length ?? 0}`);

  // 4. Re-inserer les produits
  console.log(`[import] --- Insert produits ---`);
  let inserted = 0;
  for (const p of payload.products ?? []) {
    await prisma.product.create({
      data: {
        id: p.id,
        reference: p.reference,
        name: p.name,
        description: p.description ?? "",
        note: p.note,
        categoryId: p.categoryId,
        microstoreSubCategoryId: p.microstoreSubCategoryId,
        isBestSeller: !!p.isBestSeller,
        status: p.status,
        isIncomplete: !!p.isIncomplete,
        locked: !!p.locked,
        important: !!p.important,
        dimensionLength: p.dimensionLength,
        dimensionWidth: p.dimensionWidth,
        dimensionHeight: p.dimensionHeight,
        dimensionDiameter: p.dimensionDiameter,
        dimensionCircumference: p.dimensionCircumference,
        hsCodeId: p.hsCodeId,
        countryIsoCode: p.countryIsoCode,
        seasonId: p.seasonId,
        primaryColorId: p.primaryColorId,
        primaryColorPromotionNotice: p.primaryColorPromotionNotice ?? undefined,
        lowStockThreshold: p.lowStockThreshold,
        discountPercent: p.discountPercent,
        createdAt: toDate(p.createdAt) ?? undefined,
        updatedAt: toDate(p.updatedAt) ?? undefined,
        lastRefreshedAt: toDate(p.lastRefreshedAt) ?? undefined,
        sizeDetailsTu: p.sizeDetailsTu,
        pfsProductId: p.pfsProductId,
        pfsBrandId: p.pfsBrandId,
        pfsBrandName: p.pfsBrandName,
        pfsLastSyncSnapshot: p.pfsLastSyncSnapshot ?? undefined,
        pfsCheckedAt: toDate(p.pfsCheckedAt) ?? undefined,
        pfsCheckStatus: p.pfsCheckStatus,
        pfsCheckIssues: p.pfsCheckIssues ?? undefined,
        ankorsProductId: p.ankorsProductId,
        ankorsLastSyncSnapshot: p.ankorsLastSyncSnapshot ?? undefined,
        ankorsLastRefreshedAt: toDate(p.ankorsLastRefreshedAt) ?? undefined,
        efashionReferenceBase: p.efashionReferenceBase,
        efashionLastSyncSnapshot: p.efashionLastSyncSnapshot ?? undefined,
        efashionLastRefreshedAt: toDate(p.efashionLastRefreshedAt) ?? undefined,
        faireProductId: p.faireProductId,
        faireLastSyncSnapshot: p.faireLastSyncSnapshot ?? undefined,
        faireLastRefreshedAt: toDate(p.faireLastRefreshedAt) ?? undefined,
        microstoreLastSyncSnapshot: p.microstoreLastSyncSnapshot ?? undefined,
        microstoreLastPushedAt: toDate(p.microstoreLastPushedAt) ?? undefined,
        pfsSyncRequired: !!p.pfsSyncRequired,
        ankorsSyncRequired: !!p.ankorsSyncRequired,
        efashionSyncRequired: !!p.efashionSyncRequired,
        faireSyncRequired: !!p.faireSyncRequired,
        microstoreSyncRequired: !!p.microstoreSyncRequired,
        pfsEnabled: p.pfsEnabled ?? true,
        ankorsEnabled: p.ankorsEnabled ?? true,
        efashionEnabled: p.efashionEnabled ?? true,
        faireEnabled: p.faireEnabled ?? true,
        microstoreEnabled: p.microstoreEnabled ?? true,
        pfsLastExportedAt: toDate(p.pfsLastExportedAt) ?? undefined,
        efashionLastExportedAt: toDate(p.efashionLastExportedAt) ?? undefined,
        microstoreLastExportedAt: toDate(p.microstoreLastExportedAt) ?? undefined,
        ankorstoreLastExportedAt: toDate(p.ankorstoreLastExportedAt) ?? undefined,
        faireLastExportedAt: toDate(p.faireLastExportedAt) ?? undefined,
        tenantId: T,
        // Subcategories M2M implicit
        subCategories: {
          connect: (p.subCategories ?? []).map((sc: any) => ({ id: sc.id })),
        },
        // Compositions (ProductComposition)
        compositions: {
          create: (p.compositions ?? []).map((pc: any) => ({
            compositionId: pc.compositionId,
            percentage: pc.percentage,
            tenantId: T,
          })),
        },
        // Tags (ProductTag)
        tags: {
          create: (p.tags ?? []).map((pt: any) => ({
            tagId: pt.tagId,
            tenantId: T,
          })),
        },
        // Traductions produit
        translations: {
          create: (p.translations ?? []).map((tr: any) => ({
            id: tr.id,
            locale: tr.locale,
            name: tr.name,
            description: tr.description ?? "",
            createdAt: toDate(tr.createdAt) ?? undefined,
            updatedAt: toDate(tr.updatedAt) ?? undefined,
          })),
        },
      },
    });

    // Colors + variantSizes + packLines + packLineSizes + images
    for (const c of p.colors ?? []) {
      const created = await prisma.productColor.create({
        data: {
          id: c.id,
          productId: p.id,
          colorId: c.colorId,
          unitPrice: c.unitPrice,
          weight: c.weight,
          stock: c.stock ?? 0,
          isPrimary: !!c.isPrimary,
          saleType: c.saleType,
          packQuantity: c.packQuantity,
          disabled: !!c.disabled,
          sku: c.sku,
          pfsVariantId: c.pfsVariantId,
          ankorsVariantId: c.ankorsVariantId,
          efashionProductId: c.efashionProductId,
          faireVariantId: c.faireVariantId,
          pfsColorRefOverride: c.pfsColorRefOverride,
          efashionColorIdOverride: c.efashionColorIdOverride,
          ankorsColorNameOverride: c.ankorsColorNameOverride,
          faireColorNameOverride: c.faireColorNameOverride,
          createdAt: toDate(c.createdAt) ?? undefined,
          updatedAt: toDate(c.updatedAt) ?? undefined,
          tenantId: T,
          variantSizes: {
            create: (c.variantSizes ?? []).map((vs: any) => ({
              id: vs.id,
              sizeId: vs.sizeId,
              quantity: vs.quantity ?? 1,
              pricePerUnit: vs.pricePerUnit,
              tenantId: T,
            })),
          },
          images: {
            create: (c.images ?? []).map((img: any) => ({
              id: img.id,
              productId: p.id,
              colorId: img.colorId,
              path: rewriteImagePath(img.path)!,
              order: img.order ?? 0,
              createdAt: toDate(img.createdAt) ?? undefined,
              tenantId: T,
            })),
          },
        },
      });

      // PackColorLine (multi-color packs) — separer car imbrique nested
      for (const pl of c.packLines ?? []) {
        await prisma.packColorLine.create({
          data: {
            id: pl.id,
            productColorId: created.id,
            colorId: pl.colorId,
            position: pl.position ?? 0,
            pfsColorRefOverride: pl.pfsColorRefOverride,
            efashionColorIdOverride: pl.efashionColorIdOverride,
            ankorsColorNameOverride: pl.ankorsColorNameOverride,
            faireColorNameOverride: pl.faireColorNameOverride,
            createdAt: toDate(pl.createdAt) ?? undefined,
            tenantId: T,
            sizes: {
              create: (pl.sizes ?? []).map((s: any) => ({
                id: s.id,
                sizeId: s.sizeId,
                quantity: s.quantity ?? 1,
                tenantId: T,
              })),
            },
          },
        });
      }
    }

    // colorImages (au niveau produit — legacy? existe en parallele des ProductColor.images)
    // Note : le M2M ProductColorImage a productColorId nullable; on cree si non deja reference.
    for (const img of p.colorImages ?? []) {
      // Skip s'il a deja ete cree via ProductColor.images (meme id)
      const exists = await prisma.productColorImage.findUnique({ where: { id: img.id } });
      if (exists) continue;
      await prisma.productColorImage.create({
        data: {
          id: img.id,
          productId: p.id,
          colorId: img.colorId,
          productColorId: img.productColorId,
          path: rewriteImagePath(img.path)!,
          order: img.order ?? 0,
          createdAt: toDate(img.createdAt) ?? undefined,
          tenantId: T,
        },
      });
    }

    inserted++;
    process.stdout.write(
      `\r  Produits inseres: ${inserted}/${payload.products.length}    `,
    );
  }
  console.log(``);

  // 5. Extraire images tar
  console.log(`[import] --- Extraction images ---`);
  await fs.mkdir(IMAGES_STAGING, { recursive: true });
  await runFile("tar", ["--force-local", "-xzf", IMAGES_TAR, "-C", IMAGES_STAGING]);

  // Le tar contient public/uploads/beliandjolie/produits/... — on deplace vers
  // public/uploads/beli-jolie/produits/
  const sourceProduitsDir = path.join(
    IMAGES_STAGING,
    "public",
    "uploads",
    SOURCE_TENANT_SLUG,
    "produits",
  );
  await fs.mkdir(LOCAL_UPLOAD_TARGET, { recursive: true });

  const entries = await fs.readdir(sourceProduitsDir);
  for (const dirName of entries) {
    const src = path.join(sourceProduitsDir, dirName);
    const dst = path.join(LOCAL_UPLOAD_TARGET, dirName);
    await fs.cp(src, dst, { recursive: true, force: true });
  }
  console.log(`  ${entries.length} dossier(s) images copie(s) vers ${LOCAL_UPLOAD_TARGET}`);

  // Cleanup staging
  await fs.rm(IMAGES_STAGING, { recursive: true, force: true });

  console.log(`\n[import] TERMINE : ${inserted} produits importes.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import] ERREUR", err);
  process.exit(1);
});
