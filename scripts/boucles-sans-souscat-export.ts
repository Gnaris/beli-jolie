/**
 * Exporte les produits de catégorie "Boucles d'oreilles" SANS sous-catégorie,
 * tenant beliandjolie uniquement, pour que Claude génère nom/description/sous-cat/tags.
 * Filtre : status != ARCHIVED, note ne contient pas "Complété par l'IA".
 * Usage : npx tsx scripts/boucles-sans-souscat-export.ts <N>
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

const TENANT_SLUG = "beliandjolie";
const CATEGORY_NAME = "Boucles d'oreilles";

(async () => {
  const N = parseInt(process.argv[2] ?? "1", 10);

  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  await tenantALS.run(tenant.id, async () => {
    const category = await prisma.category.findFirst({
      where: { name: CATEGORY_NAME },
      select: {
        id: true,
        name: true,
        microstoreCategoryId: true,
        subCategories: {
          select: { id: true, name: true, microstoreCategoryId: true },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!category) throw new Error(`Catégorie "${CATEGORY_NAME}" introuvable`);

    const products = await prisma.product.findMany({
      where: {
        categoryId: category.id,
        subCategories: { none: {} },
        status: { not: "ARCHIVED" },
        OR: [
          { note: null },
          { note: { not: { contains: "Complété par l'IA" } } },
        ],
      },
      take: N,
      orderBy: { createdAt: "desc" },
      include: {
        colorImages: { orderBy: { order: "asc" } },
        tags: { select: { tag: { select: { id: true, name: true } } } },
      },
    });

    const out = products.map((p) => {
      const seen = new Set<string>();
      const onePerColor: { colorId: string; path: string }[] = [];
      for (const img of p.colorImages) {
        if (img.colorId && !seen.has(img.colorId)) {
          seen.add(img.colorId);
          onePerColor.push({ colorId: img.colorId, path: img.path });
        }
      }
      return {
        id: p.id,
        reference: p.reference,
        name: p.name,
        description: p.description,
        note: p.note,
        important: p.important,
        microstoreSubCategoryId: p.microstoreSubCategoryId,
        tags: p.tags.map((pt) => ({ id: pt.tag.id, name: pt.tag.name })),
        colors: onePerColor,
      };
    });

    console.log(
      JSON.stringify(
        {
          category: {
            id: category.id,
            name: category.name,
            microstoreCategoryId: category.microstoreCategoryId,
            subCategories: category.subCategories,
          },
          requested: N,
          returned: out.length,
          products: out,
        },
        null,
        2,
      ),
    );
  });

  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
