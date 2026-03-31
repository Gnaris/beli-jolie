import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import RefreshButton from "@/components/admin/products/RefreshButton";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";
import { getCachedCategories, getCachedColors, getCachedTags, getCachedManufacturingCountries, getCachedSeasons, getCachedSizes, getCachedPfsEnabled, getCachedEfashionEnabled } from "@/lib/cached-data";
import PfsSyncButton from "@/components/pfs/PfsSyncButton";
import RetryImagesButton from "@/components/pfs/RetryImagesButton";
import EfashionSyncButton from "@/components/efashion/EfashionSyncButton";
import { ProductEditWrapper } from "@/components/admin/products/ProductEditWrapper";
import type { ProductFormHeaderState, StockState } from "@/components/admin/products/ProductFormHeaderContext";

export const metadata: Metadata = { title: "Modifier le produit" };

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default async function ModifierProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories, colors, compositions, tags, existingTranslations, colorImagesDb, manufacturingCountries, seasons, sizes, hasPfsConfig, hasEfashionConfig] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        manufacturingCountry: true,
        season: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: {
            color: true,
            subColors: {
              orderBy: { position: "asc" },
              include: { color: true },
            },
            variantSizes: {
              orderBy: { size: { position: "asc" } },
              include: { size: { include: { pfsMappings: { select: { pfsSizeRef: true } } } } },
            },
            packColorLines: {
              orderBy: { position: "asc" },
              include: {
                colors: {
                  orderBy: { position: "asc" },
                  include: { color: true },
                },
              },
            },
          },
        },
        compositions: {
          include: { composition: true },
          orderBy:  { percentage: "desc" },
        },
        subCategories:   { select: { id: true } },
        similarProducts: {
          include: {
            similar: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { name: true } },
                colors: {
                  select: { unitPrice: true },
                },
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
                colors: {
                  select: { unitPrice: true },
                },
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
                colors: {
                  select: { unitPrice: true },
                },
              },
            },
          },
        },
        tags:            { include: { tag: true } },
      },
    }),
    getCachedCategories(),
    getCachedColors(),
    prisma.composition.findMany({ orderBy: { name: "asc" } }),
    getCachedTags(),
    prisma.productTranslation.findMany({
      where:  { productId: id },
      select: { locale: true, name: true, description: true },
    }),
    prisma.productColorImage.findMany({
      where:   { productId: id },
      orderBy: { order: "asc" },
    }),
    getCachedManufacturingCountries(),
    getCachedSeasons(),
    getCachedSizes(),
    getCachedPfsEnabled(),
    getCachedEfashionEnabled(),
  ]);

  if (!product) notFound();

  // Fetch first image for all related products (similar, bundle children, bundle parents)
  const relatedIds = [
    ...product.similarProducts.map((sp) => sp.similar.id),
    ...product.bundleChildren.map((b) => b.child.id),
    ...product.bundleParents.map((b) => b.parent.id),
  ];
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

  // Map ProductColor rows → flat VariantState[]
  const initialVariants: VariantState[] = product.colors.map((pc) => ({
    tempId:        uid(),
    dbId:          pc.id,
    colorId:       pc.colorId ?? "",
    colorName:     pc.color?.name ?? "",
    colorHex:      pc.color?.hex ?? "#9CA3AF",
    subColors:     pc.subColors.map((sc) => ({
      colorId:   sc.colorId,
      colorName: sc.color.name,
      colorHex:  sc.color.hex ?? "#9CA3AF",
    })),
    packColorLines: pc.packColorLines.map((pcl) => ({
      tempId: uid(),
      colors: pcl.colors.map((c) => ({
        colorId:   c.colorId,
        colorName: c.color.name,
        colorHex:  c.color.hex ?? "#9CA3AF",
      })),
    })),
    sizeEntries:   pc.variantSizes.map((vs) => ({
      tempId:       uid(),
      sizeId:       vs.sizeId,
      sizeName:     vs.size.name,
      quantity:     String(vs.quantity),
      pricePerUnit: vs.pricePerUnit != null ? String(vs.pricePerUnit) : undefined,
    })),
    unitPrice:     (() => {
      // DB stores totalPackPrice for PACK (unitPrice × totalQty) — convert back to per-unit
      if (pc.saleType === "PACK" && pc.variantSizes.length > 0) {
        const totalQty = pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0);
        if (totalQty > 0) return String(Math.round(Number(pc.unitPrice) / totalQty * 100) / 100);
      }
      return String(pc.unitPrice);
    })(),
    weight:        String(pc.weight),
    stock:         String(pc.stock ?? 0),
    isPrimary:     pc.isPrimary,
    saleType:      pc.saleType,
    packQuantity:  pc.packQuantity != null ? String(pc.packQuantity) : "",
    discountType:  (pc.discountType ?? "") as "" | "PERCENT" | "AMOUNT",
    discountValue: pc.discountValue != null ? String(pc.discountValue) : "",
    pfsColorRef:   pc.pfsColorRef ?? "",
  }));

  // Build group key for each ProductColor — must match imageGroupKeyFromVariant() in ColorVariantManager
  function editGroupKey(pc: {
    id: string; colorId: string | null; saleType: string;
    subColors: { colorId: string; color: { name: string } }[];
    packColorLines: { colors: { colorId: string; color: { id: string } }[] }[];
  }): string {
    if (pc.saleType === "PACK") {
      if (pc.packColorLines.length === 0) return `pack::${pc.id}`;
      // Check if all lines have the same color composition (mirrors imageGroupKeyFromVariant logic)
      const lineSignatures = pc.packColorLines.map(pcl =>
        pcl.colors.map(c => c.colorId).join(",")
      );
      const allSame = lineSignatures.every(sig => sig === lineSignatures[0]);
      if (allSame && pc.packColorLines[0].colors.length > 0) {
        const colors = pc.packColorLines[0].colors;
        if (colors.length === 1) return colors[0].colorId;
        return `${colors[0].colorId}::${colors.slice(1).map(c => c.colorId).join(",")}`;
      }
      return `pack::${pc.id}`;
    }
    if (!pc.colorId) return "";
    if (pc.subColors.length === 0) return pc.colorId;
    // Must use colorId (not name) to match variantGroupKeyFromState() in ColorVariantManager
    return `${pc.colorId}::${pc.subColors.map(sc => sc.colorId).join(",")}`;
  }

  // Map ProductColor.id (dbId) → groupKey
  const dbIdToGroupKey = new Map<string, string>();
  for (const pc of product.colors) {
    dbIdToGroupKey.set(pc.id, editGroupKey(pc));
  }

  // Group ProductColorImage by groupKey → ColorImageState[] (one per color group, shared across UNIT/PACK)
  const colorImageMap = new Map<string, ColorImageState>();
  for (const img of colorImagesDb) {
    const pcId = img.productColorId ?? img.colorId;
    const gk = dbIdToGroupKey.get(pcId) ?? img.colorId;
    if (!gk) continue; // skip unmapped entries
    if (!colorImageMap.has(gk)) {
      const colorMeta = img.productColorId
        ? product.colors.find((pc) => pc.id === img.productColorId)
        : product.colors.find((pc) => pc.colorId === img.colorId);
      // Build full display name (main + sub-colors, or pack color lines)
      let allNames: string[];
      let displayHex = "#9CA3AF";
      if (colorMeta?.saleType === "PACK") {
        // PACK: build name from packColorLines
        allNames = colorMeta.packColorLines.map((pcl) =>
          pcl.colors.map((c) => c.color.name).join(" + ")
        );
        if (allNames.length === 0) allNames = ["Paquet"];
        const firstColor = colorMeta.packColorLines[0]?.colors[0]?.color;
        if (firstColor?.hex) displayHex = firstColor.hex;
      } else {
        allNames = colorMeta
          ? [colorMeta.color?.name ?? img.colorId, ...colorMeta.subColors.map((sc) => sc.color.name)]
          : [img.colorId];
        displayHex = colorMeta?.color?.hex ?? "#9CA3AF";
      }
      colorImageMap.set(gk, {
        groupKey:      gk,
        colorId:       img.colorId,
        colorName:     allNames.join(" / "),
        colorHex:      displayHex,
        imagePreviews: [],
        uploadedPaths: [],
        orders:        [],
        uploading:     false,
      });
    }
    const entry = colorImageMap.get(gk)!;
    // Avoid duplicate images (same path from multiple variants in the same group)
    if (!entry.uploadedPaths.includes(img.path)) {
      entry.imagePreviews.push(img.path);
      entry.uploadedPaths.push(img.path);
      entry.orders.push(img.order);
    }
  }
  const initialColorImages: ColorImageState[] = [...colorImageMap.values()];

  // ── Vérification des mappings PFS (seulement si PFS configuré) ──────────────
  const mappingIssues: string[] = [];

  if (hasPfsConfig) {
    if (!product.category?.pfsCategoryId) {
      mappingIssues.push(`Catégorie "${product.category?.name ?? '?'}" non mappée`);
    }
    for (const c of product.compositions) {
      if (!c.composition.pfsCompositionRef) {
        mappingIssues.push(`Composition "${c.composition.name}" non mappée`);
      }
    }
    const _seenColorIds = new Set<string>();
    const _seenSizeIds = new Set<string>();
    for (const variant of product.colors) {
      const hasOverride = !!variant.pfsColorRef;
      if (!hasOverride && variant.colorId && variant.color && !_seenColorIds.has(variant.colorId)) {
        _seenColorIds.add(variant.colorId);
        if (!variant.color.pfsColorRef) mappingIssues.push(`Couleur "${variant.color.name}" non mappée`);
      }
      if (!hasOverride) {
        for (const sc of variant.subColors) {
          if (!_seenColorIds.has(sc.colorId)) {
            _seenColorIds.add(sc.colorId);
            if (!sc.color.pfsColorRef) mappingIssues.push(`Couleur "${sc.color.name}" non mappée`);
          }
        }
      }
      if (!hasOverride) {
        for (const pcl of variant.packColorLines) {
          for (const c of pcl.colors) {
            if (!_seenColorIds.has(c.colorId)) {
              _seenColorIds.add(c.colorId);
              if (!c.color.pfsColorRef) mappingIssues.push(`Couleur "${c.color.name}" non mappée`);
            }
          }
        }
      }
      for (const vs of variant.variantSizes) {
        if (!_seenSizeIds.has(vs.sizeId)) {
          _seenSizeIds.add(vs.sizeId);
          if (!vs.size.pfsMappings || vs.size.pfsMappings.length === 0) {
            mappingIssues.push(`Taille "${vs.size.name}" non mappée`);
          }
        }
      }
    }
    if (product.manufacturingCountry && !product.manufacturingCountry.pfsCountryRef) {
      mappingIssues.push(`Pays "${product.manufacturingCountry.name}" non mappé`);
    }
    if (product.season && !product.season.pfsRef) {
      mappingIssues.push(`Saison "${product.season.name}" non mappée`);
    }
  }

  // Check for missing images on PFS products
  const hasMissingImages = hasPfsConfig && !!product.pfsProductId &&
    product.colors.some((c) => !colorImagesDb.some((img) => img.productColorId === c.id));

  // ── Initial header state ─────────────────────────────────────────────────
  const initialProductStatus = (product.status === "SYNCING" ? "OFFLINE" : product.status) as "OFFLINE" | "ONLINE" | "ARCHIVED";
  const variantsWithStock = product.colors.filter(c => c.stock !== null && c.stock !== undefined);
  const outOfStockCount = variantsWithStock.filter(c => c.stock === 0).length;
  const initialStockState: StockState =
    variantsWithStock.length > 0 && outOfStockCount === variantsWithStock.length ? "all_out" :
    outOfStockCount > 0 ? "partial_out" : "ok";
  const initialIsIncomplete =
    !product.reference?.trim() || !product.name?.trim() ||
    !product.description?.trim() || !product.categoryId ||
    product.compositions.length === 0 || product.colors.length === 0;
  const initialHeaderState: ProductFormHeaderState = {
    productStatus: initialProductStatus,
    isIncomplete: initialIsIncomplete,
    stockState: initialStockState,
  };

  return (
    <ProductEditWrapper
      initial={initialHeaderState}
      staticHeader={
        <>
          <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-2">
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <span>/</span>
            <span className="text-text-secondary truncate max-w-xs">{product.name}</span>
            <span>/</span>
            <span className="text-text-secondary">Modifier</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">Modifier le produit</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <p className="text-base text-text-muted font-body">
                  Réf. <span className="font-mono font-semibold text-text-secondary">{product.reference}</span>
                </p>
                <span className="hidden sm:block h-4 w-px bg-border" />
                <p className="text-xs text-text-muted font-body">
                  Créé le{" "}
                  <span className="text-text-secondary">
                    {product.createdAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </p>
                <span className="hidden sm:block h-4 w-px bg-border" />
                <p className="text-xs text-text-muted font-body">
                  Modifié le{" "}
                  <span className="text-text-secondary">
                    {product.updatedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </p>
                {hasPfsConfig && (
                  <PfsSyncButton
                    productId={product.id}
                    pfsProductId={product.pfsProductId}
                    pfsSyncStatus={product.pfsSyncStatus as "synced" | "pending" | "failed" | null}
                    pfsSyncError={product.pfsSyncError}
                    pfsSyncedAt={product.pfsSyncedAt?.toISOString() ?? null}
                    mappingIssues={mappingIssues}
                  />
                )}
                {hasEfashionConfig && (
                  <EfashionSyncButton
                    productId={product.id}
                    efashionProductId={product.efashionProductId}
                  />
                )}
                {hasMissingImages && (
                  <RetryImagesButton productId={product.id} />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/produits/${product.id}`}
                target="_blank"
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-bg-dark hover:text-text-primary transition-colors font-body"
                title="Voir côté client"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Voir
              </Link>
              <RefreshButton
                href={`/admin/produits/${product.id}/modifier`}
                productId={product.id}
                productName={product.name}
                productReference={product.reference}
                hasPfsConfig={hasPfsConfig}
              />
            </div>
          </div>
        </>
      }
    >
      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, patternImage: c.patternImage, pfsColorRef: c.pfsColorRef }))}
        availableSizes={sizes.map((s) => ({ id: s.id, name: s.name, categoryIds: s.categories.map((c) => c.categoryId) }))}
        availableCompositions={compositions.map((c) => ({ id: c.id, name: c.name }))}
        availableCountries={manufacturingCountries}
        availableSeasons={seasons}
        availableTags={tags}
        mode="edit"
        productId={product.id}
        hasPfsConfig={hasPfsConfig}
        initialData={{
          reference:         product.reference,
          name:              product.name,
          description:       product.description,
          categoryId:        product.categoryId,
          subCategoryIds:    product.subCategories.map((sc) => sc.id),
          variants:          initialVariants,
          colorImages:       initialColorImages,
          compositions:      product.compositions.map((c) => ({
            compositionId: c.compositionId,
            percentage:    String(c.percentage),
          })),
          similarProductIds: product.similarProducts.map((sp) => sp.similar.id),
          similarProducts: product.similarProducts.map((sp) => ({
            id: sp.similar.id,
            name: sp.similar.name,
            reference: sp.similar.reference,
            category: sp.similar.category.name,
            image: relatedImageMap.get(sp.similar.id) ?? null,
            maxPrice: sp.similar.colors.length > 0 ? Math.max(...sp.similar.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          bundleChildIds: product.bundleChildren.map((b) => b.child.id),
          bundleChildren: product.bundleChildren.map((b) => ({
            id: b.child.id,
            name: b.child.name,
            reference: b.child.reference,
            category: b.child.category.name,
            image: relatedImageMap.get(b.child.id) ?? null,
            maxPrice: b.child.colors.length > 0 ? Math.max(...b.child.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          bundleParents: product.bundleParents.map((b) => ({
            id: b.parent.id,
            name: b.parent.name,
            reference: b.parent.reference,
            category: b.parent.category.name,
            image: relatedImageMap.get(b.parent.id) ?? null,
            maxPrice: b.parent.colors.length > 0 ? Math.max(...b.parent.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          tagNames:          product.tags.map((t) => t.tag.name),
          isBestSeller:      product.isBestSeller,
          status:            product.status,
          translations:      existingTranslations,
          dimLength:        product.dimensionLength != null ? String(product.dimensionLength) : "",
          dimWidth:         product.dimensionWidth != null ? String(product.dimensionWidth) : "",
          dimHeight:        product.dimensionHeight != null ? String(product.dimensionHeight) : "",
          dimDiameter:      product.dimensionDiameter != null ? String(product.dimensionDiameter) : "",
          dimCircumference: product.dimensionCircumference != null ? String(product.dimensionCircumference) : "",
          manufacturingCountryId: product.manufacturingCountryId ?? "",
          seasonId: product.seasonId ?? "",
        }}
      />
    </ProductEditWrapper>
  );
}
