"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useSession } from "next-auth/react";
import FavoriteToggle from "@/components/client/FavoriteToggle";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useTranslations } from "next-intl";
import { canSeePrices } from "@/lib/price-visibility";
import { buildProductHandle } from "@/lib/product-url";
import { computeCardPriceCascade } from "@/lib/promotion-engine";
import AddToCartModal from "./AddToCartModal";

interface VariantData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
  unitPrice: number;
  stock: number;
}

interface ColorData {
  groupKey: string;
  colorId: string;
  hex: string | null;
  patternImage?: string | null;
  name: string;
  firstImage: string | null;
  unitPrice: number;
  isPrimary: boolean;
  totalStock: number;
  variants: VariantData[];
}

export interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

interface ProductCardProps {
  id: string;
  name: string;
  reference: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
  tags?: { id: string; name: string }[];
  isFavorite?: boolean;
  isBestSeller?: boolean;
  isNew?: boolean;
  /**
   * Cascade cumulée (remise fiche + promos AUTO stackable ciblant le produit),
   * OU meilleure promo non-stackable seule. Ne contient JAMAIS la remise
   * commerciale client — celle-ci est appliquée uniquement sur le total panier.
   */
  discountPercent?: number | null;
  /** Vrai si au moins une promo AUTO (/admin/promotions) cible le produit. */
  hasAutoPromotion?: boolean;
  clientDiscount?: ClientDiscountInfo | null;
  filteredColorIds?: string[];
  onFavoriteChange?: (isFavorite: boolean) => void;
}

// Prix par unité : pour UNIT c'est unitPrice direct, pour PACK on divise par packQuantity
function variantPricePerUnit(v: VariantData): number {
  const price = Number(v.unitPrice);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    return price / v.packQuantity;
  }
  return price;
}

export default function ProductCard({
  id, name, reference, category, subCategory, colors, tags = [], isFavorite = false,
  isBestSeller = false, isNew = false, discountPercent, hasAutoPromotion = false, clientDiscount, filteredColorIds = [], onFavoriteChange,
}: ProductCardProps) {
  const { data: session } = useSession();
  const { tp, tc } = useProductTranslation();
  const t = useTranslations("product");
  const showPrices = canSeePrices(session);

  // On masque les couleurs sans image côté client : elles existent en BDD
  // (variantes en attente d'image) mais ne doivent pas apparaître sur la
  // vignette tant qu'aucune photo n'a été ajoutée.
  const visibleColors = colors.filter((c) => c.firstImage !== null);

  // Priorité au filtre couleur actif, sinon la couleur principale, sinon la première visible.
  const primaryColor = visibleColors.find((c) => c.isPrimary) ?? visibleColors[0] ?? colors[0];
  const filteredMatch = filteredColorIds.length > 0
    ? visibleColors.find((c) => filteredColorIds.includes(c.colorId))
    : null;
  const initialColor = filteredMatch ?? primaryColor ?? visibleColors[0] ?? colors[0];
  const [selectedColor, setSelectedColor] = useState<ColorData>(initialColor);
  const [showModal, setShowModal] = useState(false);

  // Re-sync selected color quand les filtres couleur changent
  const filteredKey = filteredColorIds.join(",");
  const [prevFilteredKey, setPrevFilteredKey] = useState(filteredKey);
  if (prevFilteredKey !== filteredKey) {
    setPrevFilteredKey(filteredKey);
    if (filteredColorIds.length > 0) {
      const match = visibleColors.find((c) => filteredColorIds.includes(c.colorId));
      if (match) setSelectedColor(match);
    }
  }

  const displayed = selectedColor ?? primaryColor;
  const image = displayed?.firstImage;
  const productHref = `/produits/${buildProductHandle(name, reference)}`;

  const anyVariantHasDiscount = !!discountPercent && discountPercent > 0;

  // ── Prix affiché : première variante UNIT (fallback = première variante) ──
  // Cascade produit UNIQUEMENT (remise fiche + promo AUTO stackable).
  // La remise commerciale client s'applique en fin de panier, pas ici.
  const priceStats = (() => {
    const pool = visibleColors.length > 0 ? visibleColors : colors;
    const allVariants: VariantData[] = [];
    for (const c of pool) {
      for (const v of c.variants) {
        allVariants.push(v);
      }
    }
    if (allVariants.length === 0) return null;
    const refVariant = allVariants.find((v) => v.saleType === "UNIT") ?? allVariants[0];
    const rawPrice = variantPricePerUnit(refVariant);
    const cascade = computeCardPriceCascade(rawPrice, discountPercent);
    return {
      rawPrice,
      finalPrice: cascade.finalPrice,
      hasPromo: cascade.hasPromo,
      promoPercent: cascade.promoPercent,
    };
  })();

  // Stock global : tout épuisé ?
  const allOutOfStock = (visibleColors.length > 0 ? visibleColors : colors).every(
    (c) => (c.totalStock ?? 0) <= 0,
  );

  function handleColorSelect(c: ColorData) {
    setSelectedColor(c);
  }

  function handleOpenModal() {
    if (!session) {
      // Redirection vers login si pas connecté
      window.location.href = `/connexion?callbackUrl=${productHref}`;
      return;
    }
    setShowModal(true);
  }

  return (
    <article className="group h-full overflow-hidden flex flex-col animate-zoom-fade sm:card sm:card-hover sm:p-2.5">
      {/* Image */}
      <Link href={productHref} className="block">
        <div className="bg-bg-secondary relative overflow-hidden aspect-[4/5] md:aspect-[3/4] rounded-xl sm:rounded-[14px] border-0 sm:border sm:border-border-light">
          {image ? (
            <Image
              src={image}
              alt={tp(name)}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-12 h-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          )}

          {/* Badges gauche — Stock/BestSeller/New (max 2) */}
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1.5">
            {(() => {
              const badges: { label: string; bg: string }[] = [];
              if (allOutOfStock) badges.push({ label: t("outOfStock"), bg: "bg-text-secondary" });
              if (isBestSeller) badges.push({ label: t("badgeBestSeller"), bg: "bg-warning" });
              if (isNew) badges.push({ label: t("badgeNew"), bg: "bg-info" });
              return badges.slice(0, 2).map((b) => (
                <span key={b.label} className={`${b.bg} text-text-inverse text-[11px] font-bold font-heading px-3 py-1 rounded-full shadow-sm uppercase tracking-wide backdrop-blur-sm`}>
                  {b.label}
                </span>
              ));
            })()}
          </div>

          {/* Coin haut-droit : badge Promo + favori + coloris count */}
          <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1.5">
            {(hasAutoPromotion || anyVariantHasDiscount) && (
              <span className="bg-error text-text-inverse text-[11px] font-bold font-heading px-3 py-1 rounded-full shadow-sm uppercase tracking-wide backdrop-blur-sm">
                {t("badgePromo")}
              </span>
            )}
            {visibleColors.length > 1 && (
              <span className="bg-bg-primary text-text-muted text-[9px] font-body px-1.5 py-0.5 rounded-full border border-border">
                {t("colorCount", { count: visibleColors.length })}
              </span>
            )}
            <FavoriteToggle productId={id} isFavorite={isFavorite} onChange={onFavoriteChange} />
          </div>

          {/* Référence en overlay coin bas-droit (mobile only, sur desktop reste en texte plus bas) */}
          <span className="sm:hidden absolute bottom-1.5 right-1.5 z-10 text-[9px] font-mono tracking-wide bg-slate-900/80 text-white px-1.5 py-0.5 rounded pointer-events-none">
            {reference}
          </span>

          {/* Shimmer hover */}
          <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)",
                animation: "shimmer 1.5s ease-in-out",
              }}
            />
          </div>
        </div>
      </Link>

      {/* Infos + CTA */}
      <div className="px-0 sm:px-1.5 pt-2 sm:pt-3 pb-1 sm:pb-1.5 flex flex-col gap-2 sm:gap-3 flex-1">

        {/* Palette couleurs — wrap systématique pour que TOUTES les pastilles restent visibles. */}
        {visibleColors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:gap-1.5">
            {visibleColors.map((c) => {
              const fullName = c.name;
              const mainHex = c.hex ?? "#9CA3AF";
              const isSelected = selectedColor?.groupKey === c.groupKey;
              const swatchStyle: React.CSSProperties = c.patternImage
                ? { backgroundImage: `url(${c.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { backgroundColor: mainHex };
              return (
                <button
                  key={c.groupKey}
                  type="button"
                  aria-label={tp(fullName)}
                  aria-pressed={isSelected}
                  title={tp(fullName)}
                  onClick={() => handleColorSelect(c)}
                  className={`w-4 h-4 sm:w-8 sm:h-8 rounded-full transition-all duration-200 relative sm:border-2 ${
                    isSelected
                      ? "z-10 shadow-[0_0_0_2px_#0f172a] sm:shadow-none sm:border-text-primary sm:scale-110"
                      : filteredColorIds.includes(c.colorId)
                        ? "ring-1 ring-black/10 sm:border-text-primary/50"
                        : "ring-1 ring-slate-200 sm:ring-0 sm:border-border sm:hover:border-border-dark sm:hover:scale-110"
                  }`}
                  style={swatchStyle}
                />
              );
            })}
          </div>
        )}

        {/* Catégorie · sous-catégorie (mobile + desktop, même style compact) */}
        <p className="text-[10px] sm:text-xs text-text-muted uppercase tracking-wide truncate font-body">
          {tc(category)}{subCategory && <> · {tc(subCategory)}</>}
        </p>

        {/* Nom — min-h-[2.6em] réserve toujours 2 lignes pour uniformiser la hauteur des cartes */}
        <Link href={productHref} className="block">
          <p className="font-body font-medium sm:font-semibold text-[13px] sm:text-sm text-text-primary line-clamp-2 leading-tight sm:leading-snug hover:text-text-secondary transition-colors min-h-[2.6em]">
            {tp(name)}
          </p>
        </Link>

        {/* Référence texte desktop only (mobile = overlay image) */}
        <p className="hidden sm:block text-[11px] text-text-muted font-body">
          {t("reference")} : <span className="font-mono text-text-secondary">{reference}</span>
        </p>

        {/* Tags desktop only */}
        {tags.length > 0 && (
          <div className="hidden sm:flex flex-wrap gap-1 mt-1">
            {tags.slice(0, 3).map((tag) => (
              <Link
                key={tag.id}
                href={`/produits?tag=${tag.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted border border-border-light font-body hover:bg-bg-tertiary transition-colors"
              >
                {tc(tag.name)}
              </Link>
            ))}
            {tags.length > 3 && (
              <span className="text-[11px] px-1 py-0.5 text-text-muted font-body">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Prix affiché :
             • Prix produit final = prix initial − remise fiche − promotion (cascade).
             • Remise commerciale client appliquée uniquement au total panier. */}
        <div>
          {showPrices && priceStats ? (
            <div className="flex items-baseline gap-1 flex-wrap">
              {priceStats.hasPromo ? (
                <>
                  <span className="font-heading font-semibold text-xs sm:text-sm text-text-muted line-through">
                    {priceStats.rawPrice.toFixed(2)} &euro;
                  </span>
                  <span className="font-heading font-semibold text-xs sm:text-sm text-error">
                    {priceStats.finalPrice.toFixed(2)} &euro;
                  </span>
                </>
              ) : (
                <span className="font-heading font-semibold text-xs sm:text-sm text-bg-dark">
                  {priceStats.rawPrice.toFixed(2)} &euro;
                </span>
              )}
              <span className="text-[10px] text-text-muted font-body">{t("htUnit")}</span>
            </div>
          ) : !showPrices ? (
            <Link
              href="/connexion"
              className="inline-flex items-center gap-1.5 font-body text-sm text-text-secondary hover:text-text-primary underline-offset-4 hover:underline transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              {t("loginToSeePrices")}
            </Link>
          ) : null}
        </div>

        {/* CTA principal : ouvre modal ou incite à créer un compte */}
        <div className="mt-auto pt-2 sm:pt-3 border-t-0 sm:border-t sm:border-border-light">
          {!showPrices ? (
            <Link
              href="/inscription"
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full sm:rounded-lg text-xs font-body font-medium bg-accent text-white hover:bg-accent-dark active:scale-[0.98] transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
              </svg>
              {t("createAccountToOrder")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleOpenModal}
              disabled={allOutOfStock}
              aria-label={t("addToCart")}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full sm:rounded-lg text-xs font-body font-medium bg-bg-dark sm:bg-accent text-white hover:bg-slate-700 sm:hover:bg-accent-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              {allOutOfStock ? t("outOfStock") : t("addToCart")}
            </button>
          )}
        </div>
      </div>

      {/* Modal centré : ouverture au clic sur "Ajouter au panier" */}
      {showPrices && (
        <AddToCartModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          productId={id}
          productName={name}
          productReference={reference}
          category={category}
          subCategory={subCategory}
          colors={visibleColors.length > 0 ? visibleColors : colors}
          initialColorGroupKey={displayed?.groupKey}
          discountPercent={discountPercent}
          clientDiscount={clientDiscount}
        />
      )}
    </article>
  );
}
