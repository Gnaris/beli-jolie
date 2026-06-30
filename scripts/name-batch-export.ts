/**
 * Exporte le prochain lot de produits à compléter par le skill produits-nom.
 * Filtre = status ONLINE + note ne contient pas "Complété par l'IA".
 * Tri = createdAt DESC (plus récents en premier).
 * Usage : npx tsx scripts/name-batch-export.ts <N>
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { buildExportWhereClause } from "@/lib/name-batch-export-filter";

(async () => {
  const N = parseInt(process.argv[2] ?? "10", 10);

  const products = await prisma.product.findMany({
    where: buildExportWhereClause(),
    take: N,
    orderBy: { createdAt: "desc" },
    include: {
      colorImages: { orderBy: { order: "asc" } },
      colors: {
        select: { colorId: true, isPrimary: true },
      },
      category: {
        select: {
          id: true,
          name: true,
          subCategories: { select: { id: true, name: true } },
        },
      },
      subCategories: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { id: true, name: true } } } },
    },
  });

  const out = products.map((p) => {
    // Une image par couleur : la première rencontrée par ordre croissant
    const seenColors = new Set<string>();
    const onePerColor: { colorId: string; path: string }[] = [];
    for (const img of p.colorImages) {
      if (img.colorId && !seenColors.has(img.colorId)) {
        seenColors.add(img.colorId);
        onePerColor.push({ colorId: img.colorId, path: img.path });
      }
    }
    return {
      id: p.id,
      reference: p.reference,
      name: p.name,
      description: p.description,
      note: p.note,
      category: p.category
        ? {
            id: p.category.id,
            name: p.category.name,
            availableSubCategories: p.category.subCategories.map((s) => ({
              id: s.id,
              name: s.name,
            })),
          }
        : null,
      subCategories: p.subCategories.map((s) => ({ id: s.id, name: s.name })),
      tags: p.tags.map((pt) => ({ id: pt.tag.id, name: pt.tag.name })),
      colors: onePerColor,
      pfsProductId: p.pfsProductId,
      ankorsProductId: p.ankorsProductId,
      efashionReferenceBase: p.efashionReferenceBase,
    };
  });

  console.log(
    JSON.stringify(
      {
        requested: N,
        returned: out.length,
        products: out,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
