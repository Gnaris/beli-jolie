/**
 * Applique les mises à jour nom + description + sous-catégorie + mots-clés
 * + important=true sur un lot de produits « Boucles d'oreilles ».
 *
 * Pose également microstoreSubCategoryId = sous-catégorie attribuée (pour que
 * l'étiquette Microstore poussée corresponde à la sous-catégorie attribuée).
 *
 * Marque *SyncRequired=true pour chaque marketplace où le produit est publié,
 * sans pousser automatiquement (la cliente rafraîchira depuis l'admin).
 *
 * Les lignes « anomalie » reçoivent uniquement important=true + une note
 * ajoutée au champ `note` pour trace, mais aucun nom/sous-cat n'est touché.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const TENANT_ID = "cmrhsmaim0000vld1q6b030mh"; // beliandjolie
const CATEGORY_ID = "cmozle0a40004ekvdzybewk22"; // Boucles d'oreilles

const SUBCAT_IDS: Record<string, string> = {
  "Boucles d'oreilles pendantes": "cmtlqmycp00vl13ozirbdtz5m",
  "Créoles": "cmrorekq000pn12zbqpalg18r",
  "Ear cuffs": "cmtn4l9td048h13ozcfve6rnc",
  "Lot de boucles d'oreilles": "cmtanjc6a03dr3z4afxhqdi8w",
  "Mono-boucle d'oreille": "cmtlqnrey00vt13ozuuihm5z1",
  "Puces d'oreilles": "cmtlqnbck00vp13ozq4ooabx8",
};

interface Row {
  reference: string;
  nameProposed: string;
  descriptionProposed: string;
  subCategoryProposed: string;
  keywords: string;
  anomaly: string;
}

const prisma = new PrismaClient();

async function upsertTag(name: string): Promise<string> {
  const existing = await prisma.tag.findFirst({
    where: { tenantId: TENANT_ID, name },
  });
  if (existing) return existing.id;
  const created = await prisma.tag.create({
    data: { tenantId: TENANT_ID, name },
  });
  return created.id;
}

async function applyRow(row: Row) {
  const product = await prisma.product.findFirst({
    where: { tenantId: TENANT_ID, reference: row.reference, categoryId: CATEGORY_ID },
    select: {
      id: true,
      reference: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
    },
  });
  if (!product) {
    console.warn(`  ↳ introuvable : ${row.reference}`);
    return;
  }

  const marketplaceFlags: Record<string, boolean> = {};
  if (product.pfsProductId) marketplaceFlags.pfsSyncRequired = true;
  if (product.ankorsProductId) marketplaceFlags.ankorsSyncRequired = true;
  if (product.efashionReferenceBase) marketplaceFlags.efashionSyncRequired = true;
  if (product.faireProductId) marketplaceFlags.faireSyncRequired = true;
  if (product.orderchampProductId) marketplaceFlags.orderchampSyncRequired = true;
  if (product.microstoreProductId) marketplaceFlags.microstoreSyncRequired = true;

  if (row.anomaly) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        important: true,
        note: row.anomaly,
      },
    });
    console.log(`  ⚠️  ${row.reference} marqué important (anomalie, pas de rename)`);
    return;
  }

  const subCatId = SUBCAT_IDS[row.subCategoryProposed];
  if (!subCatId) {
    console.warn(`  ↳ sous-catégorie inconnue pour ${row.reference} : « ${row.subCategoryProposed} »`);
    return;
  }

  const keywordList = row.keywords
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const tagIds: string[] = [];
  for (const kw of keywordList) {
    tagIds.push(await upsertTag(kw));
  }

  await prisma.$transaction([
    prisma.productTag.deleteMany({ where: { productId: product.id } }),
    prisma.product.update({
      where: { id: product.id },
      data: {
        name: row.nameProposed,
        description: row.descriptionProposed,
        important: true,
        microstoreSubCategoryId: subCatId,
        subCategories: { set: [{ id: subCatId }] },
        tags: {
          create: tagIds.map((tagId) => ({
            tag: { connect: { id: tagId } },
            tenant: { connect: { id: TENANT_ID } },
          })),
        },
        ...marketplaceFlags,
      },
    }),
  ]);

  const mkts = Object.keys(marketplaceFlags)
    .map((k) => k.replace("SyncRequired", ""))
    .join(", ");
  console.log(`  ✅ ${row.reference} → « ${row.subCategoryProposed} » + ${tagIds.length} tag(s)${mkts ? ` + sync requis sur ${mkts}` : ""}`);
}

async function main() {
  const dataPath = process.argv[2];
  if (!dataPath) {
    console.error("Usage: tsx apply-earring-updates.ts <data.json>");
    process.exit(1);
  }
  const rows: Row[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Application de ${rows.length} mise(s) à jour sur tenant beliandjolie\n`);
  for (const row of rows) {
    await applyRow(row);
  }
  console.log(`\nTerminé.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
