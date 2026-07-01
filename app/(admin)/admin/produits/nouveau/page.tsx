import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { VariantState } from "@/components/admin/products/ColorVariantManager";
import {
  getCachedPfsEnabled,
  getCachedHasAnkorstoreConfig,
  getCachedAnkorstoreEnabled,
  getCachedHasEfashionConfig,
  getCachedEfashionEnabled,
  getCachedHasFaireConfig,
  getCachedFaireEnabled,
} from "@/lib/cached-data";
import { getPfsColorOptions } from "@/lib/pfs-annexes";
import { CreatePageWrapper, CreatePageChrome } from "./CreatePageWrapper";

export const metadata: Metadata = { title: "Nouveau produit" };
export const dynamic = "force-dynamic";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

const productSourceInclude = {
  category: true,
  manufacturingCountry: true,
  season: true,
  colors: {
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
    include: {
      color: true,
      variantSizes: {
        orderBy: { size: { position: "asc" as const } },
        include: { size: true },
      },
      packLines: {
        orderBy: { position: "asc" as const },
        include: {
          color: true,
          sizes: {
            orderBy: { size: { position: "asc" as const } },
            include: { size: true },
          },
        },
      },
    },
  },
  compositions: {
    include: { composition: true },
    orderBy: { percentage: "desc" as const },
  },
  subCategories: { select: { id: true } },
  similarProducts: {
    include: {
      similar: {
        select: {
          id: true,
          name: true,
          reference: true,
          category: { select: { name: true } },
          colors: { select: { unitPrice: true } },
        },
      },
    },
  },
  bundleChildren: {
    include: {
      child: {
        select: {
          id: true,
          name: true,
          reference: true,
          category: { select: { name: true } },
          colors: { select: { unitPrice: true } },
        },
      },
    },
  },
  bundleParents: {
    include: {
      parent: {
        select: {
          id: true,
          name: true,
          reference: true,
          category: { select: { name: true } },
          colors: { select: { unitPrice: true } },
        },
      },
    },
  },
  tags: { include: { tag: true } },
};

export default async function NouveauProduitPage({
  searchParams,
}: {
  searchParams: Promise<{ dupliquerDe?: string }>;
}) {
  const { dupliquerDe } = await searchParams;

  const [
    hasPfsConfig,
    hasAnkorstoreConfig,
    ankorstoreEnabled,
    hasEfashionConfig,
    efashionEnabled,
    hasFaireConfig,
    faireEnabled,
  ] = await Promise.all([
    getCachedPfsEnabled(),
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
    getCachedHasEfashionConfig(),
    getCachedEfashionEnabled(),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
  ]);

  const pfsColorOptions = hasPfsConfig ? await getPfsColorOptions() : [];

  const source = dupliquerDe
    ? await prisma.product.findUnique({
        where: { id: dupliquerDe },
        include: productSourceInclude,
      })
    : null;

  const sourceTranslations = source
    ? await prisma.productTranslation.findMany({
        where: { productId: source.id },
        select: { locale: true, name: true, description: true },
      })
    : [];

  const relatedIds = source
    ? [
        ...source.similarProducts.map((sp) => sp.similar.id),
        ...source.bundleChildren.map((b) => b.child.id),
        ...source.bundleParents.map((b) => b.parent.id),
      ]
    : [];
  const relatedFirstImages = relatedIds.length > 0
    ? await prisma.productColorImage.findMany({
        where: { productId: { in: relatedIds } },
        orderBy: { order: "asc" },
      })
    : [];
  const relatedImageMap = new Map<string, string>();
  for (const img of relatedFirstImages) {
    if (!relatedImageMap.has(img.productId)) relatedImageMap.set(img.productId, img.path);
  }

  const initialVariants: VariantState[] | undefined = source
    ? source.colors.map((pc) => {
        const hasPackLines = pc.saleType === "PACK" && pc.packLines.length > 0;
        const packLines = hasPackLines
          ? pc.packLines.map((line) => ({
              tempId: uid(),
              colorId: line.colorId,
              colorName: line.color?.name ?? "",
              colorHex: line.color?.hex ?? "#9CA3AF",
              pfsColorRefOverride: line.pfsColorRefOverride ?? null,
              sizeEntries: line.sizes.map((ls) => ({
                tempId: uid(),
                sizeId: ls.sizeId,
                sizeName: ls.size.name,
                quantity: String(ls.quantity),
              })),
            }))
          : [];
        const totalPackQty = hasPackLines
          ? packLines.reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + (parseInt(e.quantity) || 0), 0), 0)
          : pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0);
        return {
          tempId: uid(),
          colorId: pc.colorId ?? "",
          colorName: pc.color?.name ?? "",
          colorHex: pc.color?.hex ?? "#9CA3AF",
          sizeEntries: pc.variantSizes.map((vs) => ({
            tempId: uid(),
            sizeId: vs.sizeId,
            sizeName: vs.size.name,
            quantity: String(vs.quantity),
            pricePerUnit: vs.pricePerUnit != null ? String(vs.pricePerUnit) : undefined,
          })),
          packLines,
          unitPrice: (() => {
            if (pc.saleType === "PACK") {
              if (totalPackQty > 0) return String(Math.round(Number(pc.unitPrice) / totalPackQty * 100) / 100);
            }
            return String(pc.unitPrice);
          })(),
          weight: String(pc.weight),
          stock: String(pc.stock ?? 0),
          isPrimary: pc.isPrimary,
          saleType: pc.saleType,
          packQuantity: pc.packQuantity != null ? String(pc.packQuantity) : "",
          sku: "",
          disabled: false,
          pfsColorRefOverride: pc.pfsColorRefOverride ?? null,
        };
      })
    : undefined;

  const initialData = source
    ? {
        reference: "",
        name: source.name,
        description: source.description,
        categoryId: source.categoryId,
        subCategoryIds: source.subCategories.map((sc) => sc.id),
        variants: initialVariants!,
        colorImages: [],
        compositions: source.compositions.map((c) => ({
          compositionId: c.compositionId,
          percentage: String(c.percentage),
        })),
        similarProductIds: source.similarProducts.map((sp) => sp.similar.id),
        similarProducts: source.similarProducts.map((sp) => ({
          id: sp.similar.id,
          name: sp.similar.name,
          reference: sp.similar.reference,
          category: sp.similar.category.name,
          image: relatedImageMap.get(sp.similar.id) ?? null,
          maxPrice: sp.similar.colors.length > 0 ? Math.max(...sp.similar.colors.map((c) => Number(c.unitPrice))) : 0,
        })),
        bundleChildIds: source.bundleChildren.map((b) => b.child.id),
        bundleChildren: source.bundleChildren.map((b) => ({
          id: b.child.id,
          name: b.child.name,
          reference: b.child.reference,
          category: b.child.category.name,
          image: relatedImageMap.get(b.child.id) ?? null,
          maxPrice: b.child.colors.length > 0 ? Math.max(...b.child.colors.map((c) => Number(c.unitPrice))) : 0,
        })),
        bundleParents: source.bundleParents.map((b) => ({
          id: b.parent.id,
          name: b.parent.name,
          reference: b.parent.reference,
          category: b.parent.category.name,
          image: relatedImageMap.get(b.parent.id) ?? null,
          maxPrice: b.parent.colors.length > 0 ? Math.max(...b.parent.colors.map((c) => Number(c.unitPrice))) : 0,
        })),
        tagNames: source.tags.map((t) => t.tag.name),
        isBestSeller: false,
        translations: sourceTranslations,
        dimLength: source.dimensionLength != null ? String(source.dimensionLength) : "",
        dimWidth: source.dimensionWidth != null ? String(source.dimensionWidth) : "",
        dimHeight: source.dimensionHeight != null ? String(source.dimensionHeight) : "",
        dimDiameter: source.dimensionDiameter != null ? String(source.dimensionDiameter) : "",
        dimCircumference: source.dimensionCircumference != null ? String(source.dimensionCircumference) : "",
        hsCodeId: source.hsCodeId ?? "",
        manufacturingCountryId: source.manufacturingCountryId ?? "",
        seasonId: source.seasonId ?? "",
        discountPercent: source.discountPercent != null ? String(source.discountPercent) : "",
        primaryColorId: source.primaryColorId ?? null,
        sizeDetailsTu: source.sizeDetailsTu ?? "",
      }
    : undefined;

  return (
    <CreatePageWrapper>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div className="z-20 bg-bg-secondary border-b border-border -mx-6 px-6 pt-3 pb-4">
          <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-2">
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <span>/</span>
            <span className="text-text-secondary">Nouveau</span>
          </div>
          <h1 className="page-title">
            Créer un produit
          </h1>
          <CreatePageChrome />
        </div>

        <ProductForm
          mode="create"
          hasPfsConfig={hasPfsConfig}
          hasAnkorstoreConfig={hasAnkorstoreConfig}
          ankorstoreEnabled={ankorstoreEnabled}
          hasEfashionConfig={hasEfashionConfig}
          efashionEnabled={efashionEnabled}
          hasFaireConfig={hasFaireConfig}
          faireEnabled={faireEnabled}
          pfsColorOptions={pfsColorOptions}
          initialData={initialData}
        />
      </div>
    </CreatePageWrapper>
  );
}
