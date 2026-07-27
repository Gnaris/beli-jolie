import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";
import { ProductEditWrapper, StatusToggle } from "@/components/admin/products/ProductEditWrapper";
import { BestSellerToggle } from "@/components/admin/products/BestSellerToggle";
import { HeaderInlineBadges } from "@/components/admin/products/HeaderInlineBadges";
import { ProductReferenceBadge } from "@/components/admin/products/ProductReferenceBadge";
import { KpiRow } from "@/components/admin/products/KpiRow";
import type { ProductFormHeaderState, StockState } from "@/components/admin/products/ProductFormHeaderContext";
import { DraftPageWrapper } from "./DraftPageWrapper";
import { ProductEditRefreshButton } from "@/components/admin/products/ProductEditRefreshButton";
import { ProductLockToggle } from "@/components/admin/products/ProductLockToggle";
import { ProductImportantToggle } from "@/components/admin/products/ProductImportantToggle";
import { MarketplaceStatusButtons } from "@/components/admin/products/MarketplaceStatusButtons";
import ProductStatsModal from "@/components/admin/products/ProductStatsModal";
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
import { getEfashionAnnexes } from "@/lib/efashion-annexes";
import { getMarketplaceMaintenance } from "@/lib/platform-config";

export const metadata: Metadata = { title: "Modifier le produit" };
export const dynamic = "force-dynamic";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default async function ModifierProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [
    product,
    existingTranslations,
    colorImagesDb,
    hasPfsConfig,
    hasAnkorstoreConfig,
    ankorstoreEnabled,
    hasEfashionConfig,
    efashionEnabled,
    hasFaireConfig,
    faireEnabled,
    maintenance,
    brandedBadgeRow,
  ] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        season: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: {
            color: true,
            variantSizes: {
              orderBy: { size: { position: "asc" } },
              include: { size: true },
            },
            packLines: {
              orderBy: { position: "asc" },
              include: {
                color: true,
                sizes: {
                  orderBy: { size: { position: "asc" } },
                  include: { size: true },
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
        tags:            { include: { tag: true } },
      },
    }),
    prisma.productTranslation.findMany({
      where:  { productId: id },
      select: { locale: true, name: true, description: true },
    }),
    prisma.productColorImage.findMany({
      where:   { productId: id },
      orderBy: { order: "asc" },
    }),
    getCachedPfsEnabled(),
    getCachedHasAnkorstoreConfig(),
    getCachedAnkorstoreEnabled(),
    getCachedHasEfashionConfig(),
    getCachedEfashionEnabled(),
    getCachedHasFaireConfig(),
    getCachedFaireEnabled(),
    getMarketplaceMaintenance(),
    prisma.siteConfig.findFirst({ where: { key: "branded_reference_badge_enabled" }, select: { value: true } }),
  ]);
  const brandedBadgeEnabled = brandedBadgeRow?.value === "true";

  if (!product) notFound();

  // Charge les couleurs PFS disponibles (pour le sélecteur de mapping secondaire).
  // Best-effort : si l'API PFS échoue, on retombe sur une liste vide et la
  // section Mapping affiche "Couleurs PFS indisponibles".
  // Couleurs PFS au format { ref, label } pour le sélecteur de mapping secondaire.
  // On stocke la ref (ex: "GOLDEN") et on affiche le label FR (ex: "Doré").
  const pfsColorOptions = hasPfsConfig ? await getPfsColorOptions() : [];

  // Couleurs eFashion pour le sélecteur de mapping secondaire (pendant du PFS).
  // Best-effort : si l'API eFashion est down / non configurée, liste vide et la
  // section Mapping eFashion affiche "Couleurs eFashion indisponibles".
  const efashionColorOptions = hasEfashionConfig
    ? await getEfashionAnnexes()
        .then((a) => a.colors.map((c) => ({ id: c.id, label: c.fr || c.en })))
        .catch(() => [] as { id: number; label: string }[])
    : [];

  // A product is a draft only if it was explicitly created as one (isIncomplete=true)
  // AND was never imported from PFS. Imported products may have isIncomplete=true
  // due to a previous save bug — they should always show as normal "Hors ligne",
  // never as "Brouillon".
  const wasImported = !!product.pfsProductId;
  const isDraft = product.isIncomplete && product.status === "OFFLINE" && !wasImported;

  // Self-heal: if imported product got incorrectly marked as incomplete, fix it
  if (wasImported && product.isIncomplete) {
    prisma.product.update({
      where: { id },
      data: { isIncomplete: false },
    }).catch(() => {}); // fire-and-forget
  }

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

  const initialVariants: VariantState[] = product.colors.map((pc) => {
    const hasPackLines = pc.saleType === "PACK" && pc.packLines.length > 0;
    const packLines = hasPackLines
      ? pc.packLines.map((line) => ({
          tempId:    uid(),
          colorId:   line.colorId,
          colorName: line.color?.name ?? "",
          colorHex:  line.color?.hex ?? "#9CA3AF",
          pfsColorRefOverride: line.pfsColorRefOverride ?? null,
          efashionColorIdOverride: line.efashionColorIdOverride ?? null,
          sizeEntries: line.sizes.map((ls) => ({
            tempId:   uid(),
            sizeId:   ls.sizeId,
            sizeName: ls.size.name,
            quantity: String(ls.quantity),
          })),
        }))
      : [];
    const totalPackQty = hasPackLines
      ? packLines.reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + (parseInt(e.quantity) || 0), 0), 0)
      : pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0);
    return {
      tempId:        uid(),
      dbId:          pc.id,
      colorId:       pc.colorId ?? "",
      colorName:     pc.color?.name ?? "",
      colorHex:      pc.color?.hex ?? "#9CA3AF",
      sizeEntries:   pc.variantSizes.map((vs) => ({
        tempId:       uid(),
        sizeId:       vs.sizeId,
        sizeName:     vs.size.name,
        quantity:     String(vs.quantity),
        pricePerUnit: vs.pricePerUnit != null ? String(vs.pricePerUnit) : undefined,
      })),
      packLines,
      unitPrice:     (() => {
        if (pc.saleType === "PACK") {
          if (totalPackQty > 0) return String(Math.round(Number(pc.unitPrice) / totalPackQty * 100) / 100);
        }
        return String(pc.unitPrice);
      })(),
      weight:        String(pc.weight),
      stock:         String(pc.stock ?? 0),
      isPrimary:     pc.isPrimary,
      saleType:      pc.saleType,
      packQuantity:  pc.packQuantity != null ? String(pc.packQuantity) : "",
      sku:           pc.sku ?? "",
      disabled:      pc.disabled ?? false,
      pfsColorRefOverride: pc.pfsColorRefOverride ?? null,
      efashionColorIdOverride: pc.efashionColorIdOverride ?? null,
    };
  });

  const dbIdToGroupKey = new Map<string, string>();
  for (const pc of product.colors) {
    dbIdToGroupKey.set(pc.id, pc.colorId ?? "");
  }

  const colorImageMap = new Map<string, ColorImageState>();
  for (const img of colorImagesDb) {
    // Use the image's own colorId as groupKey — this ensures multi-color pack
    // images (e.g. Écru, Gris Foncé) get their own tab instead of being grouped
    // under the pack variant's main color (e.g. Noir).
    const gk = img.colorId;
    if (!gk) continue;
    if (!colorImageMap.has(gk)) {
      // Find display info: check variant colors first, then pack line colors
      let displayName: string = img.colorId;
      let displayHex: string = "#9CA3AF";
      const directMatch = product.colors.find((pc) => pc.colorId === img.colorId);
      if (directMatch?.color) {
        displayName = directMatch.color.name;
        displayHex = directMatch.color.hex ?? displayHex;
      } else {
        // Check pack line colors (multi-color packs)
        for (const pc of product.colors) {
          const plMatch = pc.packLines?.find((pl) => pl.colorId === img.colorId);
          if (plMatch?.color) {
            displayName = plMatch.color.name;
            displayHex = plMatch.color.hex ?? displayHex;
            break;
          }
        }
      }
      colorImageMap.set(gk, {
        groupKey:      gk,
        colorId:       img.colorId,
        colorName:     displayName,
        colorHex:      displayHex,
        imagePreviews: [],
        uploadedPaths: [],
        orders:        [],
        pendingFiles:  [],
        uploading:     false,
      });
    }
    const entry = colorImageMap.get(gk)!;
    if (!entry.uploadedPaths.includes(img.path)) {
      entry.imagePreviews.push(img.path);
      entry.uploadedPaths.push(img.path);
      entry.orders.push(img.order);
      entry.pendingFiles.push(null);
    }
  }
  const initialColorImages: ColorImageState[] = [...colorImageMap.values()];

  const initialProductStatus = (product.status === "SYNCING" ? "OFFLINE" : product.status) as "OFFLINE" | "ONLINE" | "ARCHIVED";
  const variantsWithStock = product.colors.filter(c => c.stock !== null && c.stock !== undefined);
  const outOfStockCount = variantsWithStock.filter(c => c.stock === 0).length;
  const initialStockState: StockState =
    variantsWithStock.length > 0 && outOfStockCount === variantsWithStock.length ? "all_out" :
    outOfStockCount > 0 ? "partial_out" : "ok";
  const initialIsIncomplete = wasImported
    ? false // Imported products are never considered drafts
    : !product.reference?.trim() || !product.name?.trim() ||
      !product.description?.trim() || !product.categoryId ||
      product.compositions.length === 0 || product.colors.length === 0;
  const initialHeaderState: ProductFormHeaderState = {
    productStatus: initialProductStatus,
    isIncomplete: initialIsIncomplete,
    stockState: initialStockState,
    isBestSeller: product.isBestSeller,
    kpi: {
      avgPrice: null,
      minPrice: null,
      maxPrice: null,
      totalStock: 0,
      linkedMarketplaces: 0,
      totalMarketplaces: 0,
      completeness: 0,
    },
  };

  if (isDraft) {
    return (
      <DraftPageWrapper>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div className="z-20 bg-bg-secondary border-b border-border -mx-6 px-6 pt-3 pb-4">
          <nav className="flex items-center gap-1.5 text-[13px] font-body text-text-muted mb-3">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary font-medium truncate max-w-xs">{product.name || "Brouillon"}</span>
          </nav>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 flex-nowrap min-w-0">
                <h1 className="font-heading text-[26px] leading-tight font-bold tracking-tight text-text-primary truncate min-w-0">
                  {product.name || "Continuer le brouillon"}
                </h1>
                <div className="flex items-center gap-3 shrink-0">
                  {product.reference && (
                    <ProductReferenceBadge reference={product.reference} />
                  )}
                  <HeaderInlineBadges />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <StatusToggle mode="create" />
              <BestSellerToggle />
            </div>
          </div>

          <KpiRow />
        </div>

        <ProductForm
          mode="create"
          productId={product.id}
          hasPfsConfig={hasPfsConfig}
          hasAnkorstoreConfig={hasAnkorstoreConfig}
          ankorstoreEnabled={ankorstoreEnabled}
          hasEfashionConfig={hasEfashionConfig}
          efashionEnabled={efashionEnabled}
          hasFaireConfig={hasFaireConfig}
          faireEnabled={faireEnabled}
          brandedBadgeEnabled={brandedBadgeEnabled}
          pfsColorOptions={pfsColorOptions}
          efashionColorOptions={efashionColorOptions}
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
            hsCodeId:         product.hsCodeId ?? "",
            countryIsoCode: product.countryIsoCode ?? "",
            seasonId: product.seasonId ?? "",
            discountPercent: product.discountPercent != null ? String(product.discountPercent) : "",
            sizeDetailsTu: product.sizeDetailsTu ?? "",
            pfsProductId: product.pfsProductId,
            ankorsProductId: product.ankorsProductId,
            efashionReferenceBase: product.efashionReferenceBase,
            faireProductId: product.faireProductId,
            primaryColorId: product.primaryColorId ?? null,
            microstoreSubCategoryId: product.microstoreSubCategoryId ?? null,
            note: product.note ?? "",
          }}
        />
      </div>
      </DraftPageWrapper>
    );
  }

  return (
    <ProductEditWrapper
      initial={initialHeaderState}
      staticHeader={
        <>
          <nav className="flex items-center gap-1.5 text-[13px] font-body text-text-muted mb-3">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary font-medium truncate max-w-xs">{product.name}</span>
          </nav>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 flex-nowrap min-w-0">
                <h1 className="font-heading text-[26px] leading-tight font-bold tracking-tight text-text-primary truncate min-w-0">
                  {product.name}
                </h1>
                <div className="flex items-center gap-3 shrink-0">
                  <ProductReferenceBadge reference={product.reference} />
                  <HeaderInlineBadges />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <StatusToggle mode="edit" />
              <BestSellerToggle />
              <ProductStatsModal
                productId={product.id}
                productName={product.name}
                reference={product.reference}
              />
              <ProductEditRefreshButton
                productId={product.id}
                reference={product.reference}
                productName={product.name}
                firstImage={colorImagesDb[0]?.path ?? null}
                status={product.status}
                isIncomplete={product.isIncomplete}
                wasImported={wasImported}
                locked={product.locked}
                hasPfsConfig={hasPfsConfig}
                hasAnkorstoreConfig={hasAnkorstoreConfig}
                ankorstoreEnabled={ankorstoreEnabled}
                hasEfashionConfig={hasEfashionConfig}
                efashionEnabled={efashionEnabled}
                hasFaireConfig={hasFaireConfig}
                faireEnabled={faireEnabled}
              />
              <ProductImportantToggle
                productId={product.id}
                initialImportant={product.important}
                variant="button"
              />
              <ProductLockToggle
                productId={product.id}
                initialLocked={product.locked}
                variant="icon"
              />
              <Link
                href={`/produits/${product.id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary bg-bg-primary border border-border rounded-md hover:bg-bg-secondary hover:border-border-dark hover:text-text-primary transition-all font-body shadow-sm whitespace-nowrap"
                title="Voir côté client"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Voir en ligne
              </Link>
            </div>
          </div>

          {/* Ligne 2 dédiée Marketplaces */}
          <div className="flex items-center gap-3 flex-wrap mt-4 pt-3 border-t border-border">
            <span className="text-[10px] font-heading font-bold uppercase tracking-[0.12em] text-text-muted">
              Marketplaces
            </span>
            <MarketplaceStatusButtons
              efashionLinked={product.colors.some((c) => c.efashionProductId !== null)}
              hasEfashionConfig={hasEfashionConfig}
              efashionEnabled={efashionEnabled}
              productId={product.id}
              reference={product.reference}
              productName={product.name}
              firstImage={colorImagesDb[0]?.path ?? null}
              pfsProductId={product.pfsProductId}
              pfsBrandName={product.pfsBrandName ?? null}
              hasPfsConfig={hasPfsConfig}
              pfsEnabled={hasPfsConfig}
              ankorsProductId={product.ankorsProductId}
              hasAnkorstoreConfig={hasAnkorstoreConfig}
              ankorstoreEnabled={ankorstoreEnabled}
              faireProductId={product.faireProductId}
              hasFaireConfig={hasFaireConfig}
              faireEnabled={faireEnabled}
              pfsSyncRequired={product.pfsSyncRequired}
              ankorsSyncRequired={product.ankorsSyncRequired}
              efashionSyncRequired={product.efashionSyncRequired}
              faireSyncRequired={product.faireSyncRequired}
              pfsEnabledForProduct={product.pfsEnabled}
              ankorsEnabledForProduct={product.ankorsEnabled}
              efashionEnabledForProduct={product.efashionEnabled}
              faireEnabledForProduct={product.faireEnabled}
              pfsMaintenance={maintenance.pfs}
              ankorstoreMaintenance={maintenance.ankorstore}
              efashionMaintenance={maintenance.efashion}
              faireMaintenance={maintenance.faire}
            />
          </div>
        </>
      }
    >
      <ProductForm
        mode="edit"
        productId={product.id}
        hasPfsConfig={hasPfsConfig}
        hasAnkorstoreConfig={hasAnkorstoreConfig}
        ankorstoreEnabled={ankorstoreEnabled}
        hasEfashionConfig={hasEfashionConfig}
        efashionEnabled={efashionEnabled}
        hasFaireConfig={hasFaireConfig}
        faireEnabled={faireEnabled}
        brandedBadgeEnabled={brandedBadgeEnabled}
        pfsColorOptions={pfsColorOptions}
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
          hsCodeId:         product.hsCodeId ?? "",
          countryIsoCode: product.countryIsoCode ?? "",
          seasonId: product.seasonId ?? "",
          discountPercent: product.discountPercent != null ? String(product.discountPercent) : "",
          sizeDetailsTu: product.sizeDetailsTu ?? "",
          pfsProductId: product.pfsProductId,
          ankorsProductId: product.ankorsProductId,
          efashionReferenceBase: product.efashionReferenceBase,
          faireProductId: product.faireProductId,
          pfsEnabledForProduct: product.pfsEnabled,
          ankorsEnabledForProduct: product.ankorsEnabled,
          efashionEnabledForProduct: product.efashionEnabled,
          faireEnabledForProduct: product.faireEnabled,
          primaryColorId: product.primaryColorId ?? null,
          microstoreSubCategoryId: product.microstoreSubCategoryId ?? null,
        }}
      />
    </ProductEditWrapper>
  );
}
