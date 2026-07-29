/**
 * DUMP-30-PRODUCTS
 *
 * A executer SUR LE VPS uniquement.
 *
 * Selectionne 30 produits varies (statuts + niveaux de liaison marketplace) du
 * tenant `beliandjolie`, serialise tout (produits + relations + referentiels
 * partages) en JSON, et tar les fichiers images correspondants.
 *
 * Sortie :
 *   /tmp/dump-30-products.json
 *   /tmp/dump-30-products-images.tar.gz
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const TENANT_ID = "cmrhsmaim0000vld1q6b030mh"; // beliandjolie prod
const OUT_JSON = "/tmp/dump-30-products.json";
const OUT_TAR = "/tmp/dump-30-products-images.tar.gz";
const PROJECT_ROOT = "/var/www/beliandjolie";

interface Bucket {
  label: string;
  where: Record<string, unknown>;
  limit: number;
}

const BUCKETS: Bucket[] = [
  {
    label: "online-fullyLinked-PFSAnkorEfa",
    where: {
      tenantId: TENANT_ID,
      status: "ONLINE",
      pfsProductId: { not: null },
      ankorsProductId: { not: null },
      efashionReferenceBase: { not: null },
    },
    limit: 10,
  },
  {
    label: "online-partialLinked",
    where: {
      tenantId: TENANT_ID,
      status: "ONLINE",
      pfsProductId: { not: null },
      OR: [{ ankorsProductId: null }, { efashionReferenceBase: null }],
    },
    limit: 6,
  },
  {
    label: "offline-complete",
    where: { tenantId: TENANT_ID, status: "OFFLINE", isIncomplete: false },
    limit: 4,
  },
  {
    label: "offline-draft",
    where: { tenantId: TENANT_ID, status: "OFFLINE", isIncomplete: true },
    limit: 6,
  },
  {
    label: "archived",
    where: { tenantId: TENANT_ID, status: "ARCHIVED" },
    limit: 4,
  },
];

const PRODUCT_INCLUDE = {
  colors: {
    include: {
      color: true,
      variantSizes: { include: { size: true } },
      packLines: {
        include: {
          color: true,
          sizes: { include: { size: true } },
        },
      },
      images: true,
    },
  },
  colorImages: true,
  compositions: { include: { composition: true } },
  tags: { include: { tag: true } },
  subCategories: true,
  translations: true,
  category: true,
  season: true,
  microstoreSubCategory: true,
  primaryColor: true,
  hsCode: true,
} as const;

async function main() {
  const prisma = new PrismaClient();
  console.log(`[dump] Tenant source: ${TENANT_ID}`);

  const pickedIds = new Set<string>();
  const pickedProducts: any[] = [];

  for (const bucket of BUCKETS) {
    const candidates = await prisma.product.findMany({
      where: { ...bucket.where, id: { notIn: Array.from(pickedIds) } },
      select: { id: true },
      take: 5000,
    });
    if (candidates.length === 0) {
      console.warn(`[dump] Bucket "${bucket.label}" vide, skip`);
      continue;
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = candidates.slice(0, bucket.limit);
    console.log(`[dump] Bucket "${bucket.label}": ${chosen.length}/${bucket.limit} produits`);

    for (const { id } of chosen) {
      pickedIds.add(id);
      const full = await prisma.product.findUnique({
        where: { id },
        include: PRODUCT_INCLUDE,
      });
      if (full) pickedProducts.push(full);
    }
  }

  console.log(`[dump] Total produits selectionnes: ${pickedProducts.length}`);

  const [
    categories,
    subCategories,
    colors,
    sizes,
    compositions,
    tags,
    seasons,
    hsCodes,
  ] = await Promise.all([
    prisma.category.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.subCategory.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.color.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.size.findMany({ where: { tenantId: TENANT_ID } }),
    prisma.composition.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.tag.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.season.findMany({ where: { tenantId: TENANT_ID }, include: { translations: true } }),
    prisma.hsCode.findMany(),
  ]);

  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      tenantIdSource: TENANT_ID,
      tenantSlugSource: "beliandjolie",
      productCount: pickedProducts.length,
    },
    referentials: {
      categories,
      subCategories,
      colors,
      sizes,
      compositions,
      tags,
      seasons,
      hsCodes,
    },
    products: pickedProducts,
  };

  const jsonText = JSON.stringify(
    payload,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  await fs.writeFile(OUT_JSON, jsonText, "utf8");
  console.log(`[dump] JSON ecrit: ${OUT_JSON} (${(jsonText.length / 1024).toFixed(0)} Ko)`);

  const productImageDirs = new Set<string>();
  for (const p of pickedProducts) {
    if (p.reference) {
      const dir = path.posix.join(
        "public/uploads/beliandjolie/produits",
        p.reference.slice(0, 5).toLowerCase(),
      );
      productImageDirs.add(dir);
    }
  }
  const relDirs = Array.from(productImageDirs);
  const argv = ["-czf", OUT_TAR, "-C", PROJECT_ROOT, "--ignore-failed-read", ...relDirs];
  console.log(`[dump] tar ${relDirs.length} dossier(s) images...`);
  try {
    await runFile("tar", argv);
  } catch (e: any) {
    console.warn(`[dump] tar warnings: ${e?.message ?? e}`);
  }
  const stat = await fs.stat(OUT_TAR).catch(() => null);
  console.log(
    `[dump] Tar ecrit: ${OUT_TAR} (${stat ? (stat.size / 1024 / 1024).toFixed(1) : "?"} Mo)`,
  );

  const linkedStats = pickedProducts.reduce(
    (acc, p) => {
      acc.pfs += p.pfsProductId ? 1 : 0;
      acc.ankor += p.ankorsProductId ? 1 : 0;
      acc.efashion += p.efashionReferenceBase ? 1 : 0;
      acc.faire += p.faireProductId ? 1 : 0;
      return acc;
    },
    { pfs: 0, ankor: 0, efashion: 0, faire: 0 },
  );
  const statusStats = pickedProducts.reduce(
    (acc, p) => {
      const k = p.isIncomplete ? "OFFLINE(brouillon)" : p.status;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(`[dump] Statuts:`, statusStats);
  console.log(`[dump] Liaisons marketplace:`, linkedStats);
  console.log(`[dump] OK`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[dump] ERREUR", err);
  process.exit(1);
});
