// Initialise position 0..N-1 par ordre alphabétique (name ou code) sur
// Category, Color, HsCode, Season, Composition. Idempotent : appelable
// autant de fois qu'on veut, n'écrase jamais une position > 0 déjà posée
// à la main via l'admin.

import { prisma } from "@/lib/prisma";

async function seedByAlphabetical<T extends { id: string }>(
  entityName: string,
  fetchAll: () => Promise<T[]>,
  updateOne: (id: string, position: number) => Promise<unknown>,
) {
  const items = await fetchAll();
  if (items.length === 0) {
    console.log(`  ${entityName} : aucun enregistrement`);
    return;
  }
  for (let i = 0; i < items.length; i++) {
    await updateOne(items[i]!.id, i);
  }
  console.log(`  ${entityName} : ${items.length} positions initialisées`);
}

async function main() {
  console.log("→ Initialisation des positions par ordre alphabétique existant…");

  // Category : uniquement celles à position = 0 (par défaut). On veut
  // pouvoir relancer sans écraser un ordre déjà défini.
  const cats = await prisma.category.findMany({
    where: { position: 0 },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (cats.length > 0) {
    // On séquence toutes les catégories 0..N-1 en repartant de zéro pour
    // éviter les collisions quand certaines sont à 0 et d'autres non.
    const all = await prisma.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    for (let i = 0; i < all.length; i++) {
      await prisma.category.update({ where: { id: all[i]!.id }, data: { position: i } });
    }
    console.log(`  Category : ${all.length} positions écrites`);
  } else {
    console.log("  Category : rien à faire");
  }

  const doEntity = async (
    label: string,
    findAll: () => Promise<Array<{ id: string; position: number }>>,
    update: (id: string, position: number) => Promise<unknown>,
  ) => {
    const all = await findAll();
    if (all.length === 0) {
      console.log(`  ${label} : aucun enregistrement`);
      return;
    }
    const anyUnset = all.some((e) => e.position === 0);
    if (!anyUnset) {
      console.log(`  ${label} : déjà initialisé (${all.length} lignes)`);
      return;
    }
    for (let i = 0; i < all.length; i++) {
      await update(all[i]!.id, i);
    }
    console.log(`  ${label} : ${all.length} positions écrites`);
  };

  await doEntity(
    "Color",
    () => prisma.color.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, position: true } }),
    (id, position) => prisma.color.update({ where: { id }, data: { position } }),
  );

  await doEntity(
    "HsCode",
    () => prisma.hsCode.findMany({ orderBy: [{ position: "asc" }, { code: "asc" }], select: { id: true, position: true } }),
    (id, position) => prisma.hsCode.update({ where: { id }, data: { position } }),
  );

  await doEntity(
    "Season",
    () => prisma.season.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, position: true } }),
    (id, position) => prisma.season.update({ where: { id }, data: { position } }),
  );

  await doEntity(
    "Composition",
    () => prisma.composition.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, position: true } }),
    (id, position) => prisma.composition.update({ where: { id }, data: { position } }),
  );

  console.log("✓ Terminé");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
