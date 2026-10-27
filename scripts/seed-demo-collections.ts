/**
 * Jeu de fausses collections pour peupler /admin/collections en local.
 * Chaque collection reçoit 4 à 8 produits ONLINE du tenant local, pris
 * au hasard parmi ceux dispo.
 *
 * Toutes les collections créées ont un nom préfixé par « [DEMO] » :
 * le nettoyage ne touche jamais une vraie collection.
 *
 * Usage :
 *   npx tsx scripts/seed-demo-collections.ts          → (re)crée le jeu
 *   npx tsx scripts/seed-demo-collections.ts --clean  → supprime le jeu
 *
 * À n'utiliser qu'en local.
 */

process.env.MULTI_TENANT_SCOPE = "off";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NAME_PREFIX = "[DEMO]";

const COLLECTIONS: Array<{ name: string; visible: boolean; min: number; max: number }> = [
  { name: "[DEMO] Coups de cœur de l'automne", visible: true,  min: 6, max: 8 },
  { name: "[DEMO] Nouveautés de la semaine",   visible: true,  min: 5, max: 7 },
  { name: "[DEMO] Essentiels du quotidien",    visible: true,  min: 6, max: 8 },
  { name: "[DEMO] Édition fêtes",              visible: false, min: 4, max: 6 },
  { name: "[DEMO] Pièces rares",               visible: false, min: 4, max: 5 },
];

function slugify(input: string): string {
  return String(input)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "collection";
}

async function resolveTenantId(): Promise<string> {
  const local = await prisma.tenantDomain.findFirst({
    where: { host: { in: ["localhost:3000", "localhost"] } },
    select: { tenantId: true },
  });
  if (local) return local.tenantId;
  const first = await prisma.tenant.findFirst({ select: { id: true } });
  if (!first) throw new Error("Aucun tenant en base.");
  return first.id;
}

async function clean(tenantId: string): Promise<number> {
  const demos = await prisma.collection.findMany({
    where: { tenantId, name: { startsWith: NAME_PREFIX } },
    select: { id: true },
  });
  if (demos.length === 0) return 0;
  const ids = demos.map((d) => d.id);
  await prisma.collectionProduct.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.collectionTranslation.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.collectionExclusion.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.collectionRule.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.collection.deleteMany({ where: { id: { in: ids } } });
  return demos.length;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  const cleanOnly = process.argv.includes("--clean");
  const tenantId = await resolveTenantId();

  const removed = await clean(tenantId);
  if (removed > 0) console.log(`🧹 ${removed} collection(s) de démo supprimée(s).`);

  if (cleanOnly) {
    console.log("✅ Nettoyage terminé.");
    return;
  }

  // On prend tous les produits ONLINE du tenant qui ont au moins une
  // couleur UNIT (sinon l'éditeur ne peut rien afficher dans la grille).
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      status: "ONLINE",
      colors: { some: { saleType: "UNIT" } },
    },
    select: { id: true },
  });

  if (products.length === 0) {
    console.log("⚠️  Aucun produit ONLINE avec couleur UNIT. Rien à peupler.");
    return;
  }

  console.log(`📦 ${products.length} produit(s) ONLINE dispo pour peupler les collections.`);

  for (const spec of COLLECTIONS) {
    const target = Math.min(
      products.length,
      spec.min + Math.floor(Math.random() * (spec.max - spec.min + 1)),
    );
    const picked = pickRandom(products, target);

    const baseSlug = slugify(spec.name.replace(NAME_PREFIX, "").trim()) || "demo";
    let slug = `demo-${baseSlug}`;
    let n = 2;
    while (await prisma.collection.findFirst({ where: { tenantId, slug }, select: { id: true } })) {
      slug = `demo-${baseSlug}-${n++}`;
    }

    const collection = await prisma.collection.create({
      data: {
        tenantId,
        name: spec.name,
        slug,
        visible: spec.visible,
      },
    });

    await prisma.collectionProduct.createMany({
      data: picked.map((p, idx) => ({
        collectionId: collection.id,
        productId: p.id,
        position: idx,
        source: "MANUAL" as const,
        tenantId,
      })),
    });

    console.log(`  ✅ ${spec.name} — ${picked.length} produit(s), ${spec.visible ? "visible" : "masquée"}`);
  }

  console.log("\n✨ Jeu de démo prêt. Ouvre /admin/collections pour vérifier.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
