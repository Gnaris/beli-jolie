/**
 * Exporte le prochain lot de produits à compléter par le skill produits-nom.
 * Filtre = status ONLINE + note ne contient pas "Complété par l'IA".
 * Tri = createdAt DESC (plus récents en premier).
 * Usage : npx tsx scripts/name-batch-export.ts <N>
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { buildExportWhereClause } from "@/lib/name-batch-export-filter";

const SKILL_TENANT_SLUG = "beliandjolie";

(async () => {
  const N = parseInt(process.argv[2] ?? "10", 10);

  const tenant = await prisma.tenant.findFirst({
    where: { slug: SKILL_TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) {
    throw new Error(
      `Tenant "${SKILL_TENANT_SLUG}" introuvable — le skill produits-nom ne cible que cette boutique.`,
    );
  }

  await tenantALS.run(tenant.id, () => runExport(N));
  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});

async function runExport(N: number) {
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

  // Recherche des sous-produits d'une parure : la ref se termine par "E" et la catégorie est "Parure de bijoux".
  // On enlève le "E" pour obtenir la base et on cherche tout ce qui commence par cette base
  // avec au plus un caractère suffixe (ex : A2591 → A2591, A2591A, A2591B, A2591C…).
  const parureIds = products
    .filter(
      (p) =>
        p.category?.name === "Parure de bijoux" && /E$/.test(p.reference),
    )
    .map((p) => ({
      id: p.id,
      base: p.reference.slice(0, -1),
      selfRef: p.reference,
    }));

  const siblingsByProductId = new Map<
    string,
    { ref: string; category: string }[]
  >();
  for (const parure of parureIds) {
    const rows = await prisma.product.findMany({
      where: {
        reference: { startsWith: parure.base },
        NOT: { reference: parure.selfRef },
      },
      select: {
        reference: true,
        category: { select: { name: true } },
      },
    });
    const filtered = rows
      .filter((r) => r.reference.length <= parure.base.length + 1)
      .map((r) => ({
        ref: r.reference,
        category: r.category?.name ?? "(sans catégorie)",
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref));
    siblingsByProductId.set(parure.id, filtered);
  }

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
      siblings: siblingsByProductId.get(p.id) ?? [],
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
}
