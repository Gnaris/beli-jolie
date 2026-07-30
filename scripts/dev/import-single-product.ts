/**
 * IMPORT-SINGLE-PRODUCT
 *
 * A exécuter EN LOCAL. Lit `tmp-dump/dump-<REF>.json` +
 * `tmp-dump/dump-<REF>-images.tar.gz` produits par `dump-single-product.ts` sur
 * le VPS, puis insère le produit dans la BDD LOCALE de manière ADDITIVE :
 *  - upsert par ID de chaque référentiel utilisé (skip si déjà présent)
 *  - delete du produit local (par référence) s'il existe, puis re-create
 *  - upsert des SiteConfig microstore_picture_station_* (mêmes valeurs chiffrées
 *    — suppose que l'ENCRYPTION_KEY locale est identique à celle du VPS)
 *  - extrait le tar dans `public/uploads/beliandjolie/produits/`
 *
 * Ne touche PAS aux autres produits/référentiels existants en local.
 *
 * Usage :
 *   npx tsx scripts/dev/import-single-product.ts A2630
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function toDate(v: any): Date | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  return new Date(v);
}

async function upsertReferential<T extends { id: string }>(
  label: string,
  rows: T[],
  buildCreate: (r: T) => any,
  prismaModel: { findUnique: (a: any) => Promise<any>; create: (a: any) => Promise<any> },
) {
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await prismaModel.findUnique({ where: { id: r.id } });
    if (existing) {
      skipped++;
      continue;
    }
    try {
      await prismaModel.create({ data: buildCreate(r) });
      created++;
    } catch (err: any) {
      // P2002 = collision sur @@unique composite → un autre id existe déjà
      // avec le même (tenantId, name/slug). On skip, l'appelant devra remapper
      // manuellement si besoin — mais ce cas est très improbable si le local
      // partage le même tenant que la source.
      console.warn(`  ${label} ${r.id}: ${err.code ?? err.message}`);
      skipped++;
    }
  }
  console.log(`  ${label.padEnd(14)} +${created} / skip ${skipped}`);
}

async function main() {
  const reference = process.argv[2]?.trim();
  if (!reference) {
    console.error("Usage: npx tsx scripts/dev/import-single-product.ts <REFERENCE>");
    process.exit(2);
  }

  const DUMP_JSON = path.join(PROJECT_ROOT, "tmp-dump", `dump-${reference}.json`);
  const IMAGES_TAR = path.join(PROJECT_ROOT, "tmp-dump", `dump-${reference}-images.tar.gz`);
  const IMAGES_STAGING = path.join(PROJECT_ROOT, "tmp-dump", `staging-${reference}`);

  console.log(`[import] Chargement du dump: ${DUMP_JSON}`);
  const raw = await fs.readFile(DUMP_JSON, "utf8");
  const payload = JSON.parse(raw) as any;
  const p = payload.product;
  if (!p || p.reference !== reference) {
    throw new Error(`Le dump ne contient pas le produit ${reference}`);
  }

  const prisma = new PrismaClient();
  const localTenant = await prisma.tenant.findUnique({ where: { slug: payload.meta.tenantSlugSource } });
  if (!localTenant) {
    throw new Error(
      `Tenant local "${payload.meta.tenantSlugSource}" introuvable. Ce script suppose le même slug de tenant que la source.`,
    );
  }
  const T = localTenant.id;
  if (T !== payload.meta.tenantIdSource) {
    console.warn(
      `[import] Attention : tenant local id ${T} != source id ${payload.meta.tenantIdSource}. Les référentiels dumpés seront insérés avec le tenantId local.`,
    );
  }
  console.log(`[import] Tenant local: ${localTenant.slug} (${T})`);

  const R = payload.referentials;

  console.log(`[import] --- Upsert référentiels ---`);
  await upsertReferential("HsCode", R.hsCodes ?? [], (h) => ({
    id: h.id, code: h.code, label: h.label, position: h.position ?? 0,
    createdAt: toDate(h.createdAt) ?? undefined,
  }), prisma.hsCode);

  await upsertReferential("Category", R.categories ?? [], (c) => ({
    id: c.id, name: c.name, slug: c.slug,
    pfsCategoryId: c.pfsCategoryId, pfsGender: c.pfsGender,
    pfsFamilyId: c.pfsFamilyId, pfsFamilyName: c.pfsFamilyName,
    pfsCategoryName: c.pfsCategoryName,
    efashionCategorieId: c.efashionCategorieId,
    faireTaxonomyId: c.faireTaxonomyId, faireHsCode: c.faireHsCode,
    position: c.position ?? 0, createdAt: toDate(c.createdAt) ?? undefined,
    tenantId: T,
    translations: {
      create: (c.translations ?? []).map((t: any) => ({
        id: t.id, locale: t.locale, name: t.name,
        createdAt: toDate(t.createdAt) ?? undefined,
      })),
    },
  }), prisma.category);

  await upsertReferential("SubCategory", R.subCategories ?? [], (s) => ({
    id: s.id, name: s.name, slug: s.slug, categoryId: s.categoryId,
    position: s.position ?? undefined,
    createdAt: toDate(s.createdAt) ?? undefined, tenantId: T,
    translations: {
      create: (s.translations ?? []).map((t: any) => ({
        id: t.id, locale: t.locale, name: t.name,
        createdAt: toDate(t.createdAt) ?? undefined,
      })),
    },
  }), prisma.subCategory);

  await upsertReferential("Color", R.colors ?? [], (c) => ({
    id: c.id, name: c.name, hex: c.hex, patternImage: c.patternImage,
    pfsColorRef: c.pfsColorRef, efashionColorId: c.efashionColorId,
    position: c.position ?? 0,
    createdAt: toDate(c.createdAt) ?? undefined, tenantId: T,
    translations: {
      create: (c.translations ?? []).map((t: any) => ({
        id: t.id, locale: t.locale, name: t.name,
        createdAt: toDate(t.createdAt) ?? undefined,
      })),
    },
  }), prisma.color);

  await upsertReferential("Size", R.sizes ?? [], (s) => ({
    id: s.id, name: s.name, position: s.position ?? 0, pfsSizeRef: s.pfsSizeRef,
    createdAt: toDate(s.createdAt) ?? undefined,
    updatedAt: toDate(s.updatedAt) ?? undefined, tenantId: T,
  }), prisma.size);

  await upsertReferential("Composition", R.compositions ?? [], (c) => ({
    id: c.id, name: c.name, pfsCompositionRef: c.pfsCompositionRef,
    efashionId: c.efashionId, faireMaterialLabel: c.faireMaterialLabel,
    position: c.position ?? 0, createdAt: toDate(c.createdAt) ?? undefined,
    tenantId: T,
    translations: {
      create: (c.translations ?? []).map((t: any) => ({
        id: t.id, locale: t.locale, name: t.name,
        createdAt: toDate(t.createdAt) ?? undefined,
      })),
    },
  }), prisma.composition);

  await upsertReferential("Tag", R.tags ?? [], (t) => ({
    id: t.id, name: t.name,
    createdAt: toDate(t.createdAt) ?? undefined, tenantId: T,
    translations: {
      create: (t.translations ?? []).map((tr: any) => ({
        id: tr.id, locale: tr.locale, name: tr.name,
        createdAt: toDate(tr.createdAt) ?? undefined,
      })),
    },
  }), prisma.tag);

  await upsertReferential("Season", R.seasons ?? [], (s) => ({
    id: s.id, name: s.name, pfsRef: s.pfsRef,
    efashionCollectionId: s.efashionCollectionId, position: s.position ?? 0,
    createdAt: toDate(s.createdAt) ?? undefined, tenantId: T,
    translations: {
      create: (s.translations ?? []).map((tr: any) => ({
        id: tr.id, locale: tr.locale, name: tr.name,
        createdAt: toDate(tr.createdAt) ?? undefined,
      })),
    },
  }), prisma.season);

  console.log(`[import] --- Produit ${reference} ---`);
  const existing = await prisma.product.findFirst({ where: { reference, tenantId: T } });
  if (existing) {
    console.log(`  Existe déjà (${existing.id}) → delete cascade avant re-create`);
    await prisma.product.delete({ where: { id: existing.id } });
  }

  await prisma.product.create({
    data: {
      id: p.id, reference: p.reference, name: p.name,
      description: p.description ?? "", note: p.note,
      categoryId: p.categoryId,
      microstoreSubCategoryId: p.microstoreSubCategoryId,
      isBestSeller: !!p.isBestSeller, status: p.status,
      isIncomplete: !!p.isIncomplete, locked: !!p.locked, important: !!p.important,
      dimensionLength: p.dimensionLength, dimensionWidth: p.dimensionWidth,
      dimensionHeight: p.dimensionHeight, dimensionDiameter: p.dimensionDiameter,
      dimensionCircumference: p.dimensionCircumference,
      hsCodeId: p.hsCodeId, countryIsoCode: p.countryIsoCode,
      seasonId: p.seasonId, primaryColorId: p.primaryColorId,
      primaryColorPromotionNotice: p.primaryColorPromotionNotice ?? undefined,
      lowStockThreshold: p.lowStockThreshold, discountPercent: p.discountPercent,
      createdAt: toDate(p.createdAt) ?? undefined,
      updatedAt: toDate(p.updatedAt) ?? undefined,
      lastRefreshedAt: toDate(p.lastRefreshedAt) ?? undefined,
      sizeDetailsTu: p.sizeDetailsTu,
      pfsProductId: p.pfsProductId, pfsBrandId: p.pfsBrandId,
      pfsBrandName: p.pfsBrandName,
      pfsLastSyncSnapshot: p.pfsLastSyncSnapshot ?? undefined,
      pfsCheckedAt: toDate(p.pfsCheckedAt) ?? undefined,
      pfsCheckStatus: p.pfsCheckStatus, pfsCheckIssues: p.pfsCheckIssues ?? undefined,
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
      pfsEnabled: p.pfsEnabled ?? true, ankorsEnabled: p.ankorsEnabled ?? true,
      efashionEnabled: p.efashionEnabled ?? true, faireEnabled: p.faireEnabled ?? true,
      microstoreEnabled: p.microstoreEnabled ?? true,
      pfsLastExportedAt: toDate(p.pfsLastExportedAt) ?? undefined,
      efashionLastExportedAt: toDate(p.efashionLastExportedAt) ?? undefined,
      microstoreLastExportedAt: toDate(p.microstoreLastExportedAt) ?? undefined,
      ankorstoreLastExportedAt: toDate(p.ankorstoreLastExportedAt) ?? undefined,
      faireLastExportedAt: toDate(p.faireLastExportedAt) ?? undefined,
      tenantId: T,
      subCategories: {
        connect: (p.subCategories ?? []).map((sc: any) => ({ id: sc.id })),
      },
      compositions: {
        create: (p.compositions ?? []).map((pc: any) => ({
          compositionId: pc.compositionId, percentage: pc.percentage, tenantId: T,
        })),
      },
      tags: {
        create: (p.tags ?? []).map((pt: any) => ({
          tagId: pt.tagId, tenantId: T,
        })),
      },
      translations: {
        create: (p.translations ?? []).map((tr: any) => ({
          id: tr.id, locale: tr.locale, name: tr.name,
          description: tr.description ?? "",
          createdAt: toDate(tr.createdAt) ?? undefined,
          updatedAt: toDate(tr.updatedAt) ?? undefined,
        })),
      },
    },
  });

  for (const c of p.colors ?? []) {
    await prisma.productColor.create({
      data: {
        id: c.id, productId: p.id, colorId: c.colorId,
        unitPrice: c.unitPrice, weight: c.weight, stock: c.stock ?? 0,
        isPrimary: !!c.isPrimary, saleType: c.saleType,
        packQuantity: c.packQuantity, disabled: !!c.disabled, sku: c.sku,
        pfsVariantId: c.pfsVariantId, ankorsVariantId: c.ankorsVariantId,
        efashionProductId: c.efashionProductId, faireVariantId: c.faireVariantId,
        pfsColorRefOverride: c.pfsColorRefOverride,
        efashionColorIdOverride: c.efashionColorIdOverride,
        ankorsColorNameOverride: c.ankorsColorNameOverride,
        faireColorNameOverride: c.faireColorNameOverride,
        createdAt: toDate(c.createdAt) ?? undefined,
        updatedAt: toDate(c.updatedAt) ?? undefined,
        tenantId: T,
        variantSizes: {
          create: (c.variantSizes ?? []).map((vs: any) => ({
            id: vs.id, sizeId: vs.sizeId, quantity: vs.quantity ?? 1,
            pricePerUnit: vs.pricePerUnit, tenantId: T,
          })),
        },
        images: {
          create: (c.images ?? []).map((img: any) => ({
            id: img.id, productId: p.id, colorId: img.colorId,
            path: img.path, order: img.order ?? 0,
            createdAt: toDate(img.createdAt) ?? undefined, tenantId: T,
          })),
        },
      },
    });
    for (const pl of c.packLines ?? []) {
      await prisma.packColorLine.create({
        data: {
          id: pl.id, productColorId: c.id, colorId: pl.colorId,
          position: pl.position ?? 0,
          pfsColorRefOverride: pl.pfsColorRefOverride,
          efashionColorIdOverride: pl.efashionColorIdOverride,
          ankorsColorNameOverride: pl.ankorsColorNameOverride,
          faireColorNameOverride: pl.faireColorNameOverride,
          createdAt: toDate(pl.createdAt) ?? undefined, tenantId: T,
          sizes: {
            create: (pl.sizes ?? []).map((s: any) => ({
              id: s.id, sizeId: s.sizeId, quantity: s.quantity ?? 1, tenantId: T,
            })),
          },
        },
      });
    }
  }

  for (const img of p.colorImages ?? []) {
    const exists = await prisma.productColorImage.findUnique({ where: { id: img.id } });
    if (exists) continue;
    await prisma.productColorImage.create({
      data: {
        id: img.id, productId: p.id, colorId: img.colorId,
        productColorId: img.productColorId, path: img.path, order: img.order ?? 0,
        createdAt: toDate(img.createdAt) ?? undefined, tenantId: T,
      },
    });
  }
  console.log(`  Produit inséré: ${p.reference} (${p.id})`);

  // SiteConfig microstore_picture_station_*
  console.log(`[import] --- SiteConfig microstore ---`);
  for (const cfg of payload.siteConfigs ?? []) {
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId: T, key: cfg.key } },
      update: { value: cfg.value },
      create: { tenantId: T, key: cfg.key, value: cfg.value },
    });
    console.log(`  ${cfg.key} : posé`);
  }

  // Extraction images
  console.log(`[import] --- Extraction images ---`);
  const tarExists = await fs.stat(IMAGES_TAR).then(() => true).catch(() => false);
  if (!tarExists) {
    console.warn(`  Tar introuvable: ${IMAGES_TAR} — skip`);
  } else {
    await fs.mkdir(IMAGES_STAGING, { recursive: true });
    // Windows tar (bsdtar) mangle les backslashes ; on force le forward-slash.
    const posix = (p: string) => p.replace(/\\/g, "/");
    await runFile("tar", ["--force-local", "-xzf", posix(IMAGES_TAR), "-C", posix(IMAGES_STAGING)]);
    // Le tar contient public/uploads/beliandjolie/produits/<xxxxx>/<REF>/
    // On copie récursivement dans le vrai public/uploads/
    const stagingRoot = path.join(IMAGES_STAGING, "public", "uploads");
    const localUploads = path.join(PROJECT_ROOT, "public", "uploads");
    // Copie récursive du contenu
    async function copyDir(src: string, dst: string) {
      await fs.mkdir(dst, { recursive: true });
      const items = await fs.readdir(src, { withFileTypes: true });
      for (const it of items) {
        const s = path.join(src, it.name);
        const d = path.join(dst, it.name);
        if (it.isDirectory()) await copyDir(s, d);
        else await fs.cp(s, d, { force: true });
      }
    }
    await copyDir(stagingRoot, localUploads);
    await fs.rm(IMAGES_STAGING, { recursive: true, force: true });
    console.log(`  Images copiées vers ${localUploads}`);
  }

  console.log(`[import] TERMINÉ`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import] ERREUR", err);
  process.exit(1);
});
