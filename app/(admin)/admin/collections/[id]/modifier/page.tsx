import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getCachedCategories,
  getCachedColors,
  getCachedCompositions,
  getCachedSeasons,
  getCachedTags,
} from "@/lib/cached-data";
import CollectionEditor from "@/components/admin/collections/CollectionEditor";
import { parseStoredRule } from "@/lib/collection-rules";

export const metadata: Metadata = { title: "Modifier la collection — Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditCollectionPage({ params }: Props) {
  const { id } = await params;

  const [collection, categories, colors, compositions, seasons, tags, exclusions] =
    await Promise.all([
      prisma.collection.findUnique({
        where: { id },
        include: {
          translations: true,
          rule: {
            select: {
              seasonId: true,
              categoryIds: true,
              subCategoryIds: true,
              tagIds: true,
              compositions: true,
              lastRecalculatedAt: true,
            },
          },
          products: {
            orderBy: { position: "asc" },
            include: {
              product: {
                include: {
                  colorImages: { orderBy: { order: "asc" } },
                  colors: {
                    where: { saleType: "UNIT" },
                    include: {
                      color: { select: { id: true, name: true, hex: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      getCachedCategories(),
      getCachedColors(),
      getCachedCompositions(),
      getCachedSeasons(),
      getCachedTags(),
      prisma.collectionExclusion.findMany({
        where: { collectionId: id },
        orderBy: { excludedAt: "desc" },
        select: {
          productId: true,
          excludedAt: true,
          product: { select: { name: true, reference: true } },
        },
      }),
    ]);

  if (!collection) notFound();

  // Build translations map
  const translationsMap: Record<string, string> = {};
  for (const t of collection.translations) {
    translationsMap[t.locale] = t.name;
  }

  // Serialize for client (Decimal → number, Date → string)
  const serialized = JSON.parse(
    JSON.stringify(
      {
        id: collection.id,
        slug: collection.slug,
        name: collection.name,
        image: collection.image,
        imageBanner: collection.imageBanner,
        translations: translationsMap,
        products: collection.products.map((cp) => ({
          productId: cp.productId,
          colorId: cp.colorId,
          position: cp.position,
          source: cp.source,
          product: {
            id: cp.product.id,
            name: cp.product.name,
            reference: cp.product.reference,
            colorImages: cp.product.colorImages.map((img) => ({
              path: img.path,
              colorId: img.colorId,
            })),
            colors: cp.product.colors.map((pc) => ({
              colorId: pc.colorId,
              isPrimary: pc.isPrimary,
              unitPrice: pc.unitPrice,
              color: pc.color,
            })),
          },
        })),
      },
      (_key, value) =>
        value !== null && typeof value === "object" && typeof value.toNumber === "function"
          ? value.toNumber()
          : value,
    ),
  );

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const subCategoryOptions = categories.flatMap((c) =>
    c.subCategories.map((sc) => ({ id: sc.id, name: sc.name, categoryId: c.id })),
  );
  const colorOptions = colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
  const compositionOptions = compositions.map((c) => ({ id: c.id, name: c.name }));

  // Règle stockée en JSON → shape éditable côté client.
  const parsedRule = collection.rule
    ? {
        ...parseStoredRule(collection.rule),
        lastRecalculatedAt: collection.rule.lastRecalculatedAt
          ? collection.rule.lastRecalculatedAt.toISOString()
          : null,
      }
    : null;

  const ruleData = {
    seasons: seasons.map((s) => ({ id: s.id, name: s.name })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    initialRule: parsedRule
      ? {
          seasonId: parsedRule.seasonId,
          categoryIds: parsedRule.categoryIds,
          subCategoryIds: parsedRule.subCategoryIds,
          tagIds: parsedRule.tagIds,
          compositions: parsedRule.compositions.map((c) => ({
            compositionId: c.compositionId,
            minPercent: c.minPercent ?? null,
          })),
        }
      : null,
    initialLastRecalculatedAt: parsedRule?.lastRecalculatedAt ?? null,
    exclusions: exclusions.map((e) => ({
      productId: e.productId,
      excludedAt: e.excludedAt.toISOString(),
      name: e.product.name,
      reference: e.product.reference,
    })),
  };

  return (
    <CollectionEditor
      collection={serialized}
      categories={categoryOptions}
      filterOptions={{
        subCategories: subCategoryOptions,
        colors: colorOptions,
        compositions: compositionOptions,
      }}
      ruleData={ruleData}
    />
  );
}
