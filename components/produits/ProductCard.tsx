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
  /** Masque les badges "Nouveau" et "Promo" (utilisé sur les carrousels de la home). */
  hideStatusBadges?: boolean;
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
  hideStatusBadges = false,
}: ProductCardProps) {
  const { data: session } = useSession();
  const { tp, tc } = useProductTranslation();
  const t = useTranslations("product");
  const showPrices = canSeePrices(session);
  // Cliente connectée mais non validée : on adapte les CTA pour ne pas
  // lui proposer « Créer un compte » / « Connectez-vous » alors qu'elle
  // l'est déjà — on l'oriente vers son espace pour suivre la vérification.
  const isPendingConnected = !showPrices && !!session?.user?.id;
  // Compte révoqué : même flux visuel que « en attente » mais message rouge
  // (« Compte désactivé — prix indisponibles ») au lieu du bleu d'attente.
  const isRevokedConnected =
    isPendingConnected && session?.user?.status === "REJECTED";

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
  const [hoveredColor, setHoveredColor] = useState<ColorData | null>(null);
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

  const displayed = hoveredColor ?? selectedColor ?? primaryColor;
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
    <article className="group h-full flex flex-col">
      {/* Image */}
      <Link href={productHref} className="block">
        <div className="bg-[#fafaf7] relative overflow-hidden aspect-[4/5]">
          {image ? (
            <Image
              src={image}
              alt={tp(name)}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.2,0.6,0.2,1)] group-hover:scale-[1.05]"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </div>
          )}

          {/* Étiquette d'état (max 1) — pill noire minimaliste haut-gauche */}
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
            {(() => {
              const label = allOutOfStock
                ? t("outOfStock")
                : !hideStatusBadges && (hasAutoPromotion || anyVariantHasDiscount)
                  ? t("badgePromo")
                  : !hideStatusBadges && isNew
                    ? t("badgeNew")
                    : !hideStatusBadges && isBestSeller
                      ? t("badgeBestSeller")
                      : null;
              if (!label) return null;
              return (
                <span className="bg-black text-white text-[10px] tracking-[0.22em] uppercase font-medium px-2.5 py-1.5">
                  {label}
                </span>
              );
            })()}
          </div>

          {/* Favori — apparaît en douceur au survol (desktop), toujours visible mobile */}
          <div className="absolute top-2.5 right-2.5 z-10 sm:opacity-0 sm:-translate-y-1 sm:group-hover:opacity-100 sm:group-hover:translate-y-0 transition-all duration-300">
            <FavoriteToggle productId={id} isFavorite={isFavorite} onChange={onFavoriteChange} />
          </div>

        </div>
      </Link>

      {/* Infos */}
      <div className="pt-4 sm:pt-5 flex flex-col gap-3 flex-1">

        {/* Ligne 1 : ref — catégorie + prix */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.22em] text-text-muted font-body mb-1.5 truncate">
              {reference} — {tc(category)}{subCategory && <> · {tc(subCategory)}</>}
            </div>
            <Link href={productHref} className="block">
              <p className="font-body text-[13px] sm:text-[14px] text-text-primary leading-snug line-clamp-2 min-h-[2.4em] hover:text-text-secondary transition-colors">
                {tp(name)}
              </p>
            </Link>
          </div>

          {/* Prix — colonne droite */}
          <div className="text-right shrink-0">
            {showPrices && priceStats ? (
              priceStats.hasPromo ? (
                <>
                  <div className="font-body text-[13px] sm:text-[14px] font-medium text-text-primary">
                    {priceStats.finalPrice.toFixed(2)} €
                  </div>
                  <div className="font-body text-[11px] text-text-muted line-through mt-0.5">
                    {priceStats.rawPrice.toFixed(2)} €
                  </div>
                </>
              ) : (
                <div className="font-body text-[13px] sm:text-[14px] font-medium text-text-primary">
                  {priceStats.rawPrice.toFixed(2)} €
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Palette couleurs — pastilles */}
        {visibleColors.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {visibleColors.slice(0, 6).map((c) => {
              const fullName = c.name;
              const mainHex = c.hex ?? "#9CA3AF";
              const isSelected = selectedColor?.groupKey === c.groupKey;
              const swatchStyle: React.CSSProperties = c.patternImage
                ? { backgroundImage: `url(${c.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { backgroundColor: mainHex };
              const isWhite = !c.patternImage && mainHex.toLowerCase() === "#ffffff";
              return (
                <button
                  key={c.groupKey}
                  type="button"
                  aria-label={tp(fullName)}
                  aria-pressed={isSelected}
                  title={tp(fullName)}
                  onClick={() => handleColorSelect(c)}
                  onMouseEnter={() => setHoveredColor(c)}
                  onMouseLeave={() => setHoveredColor(null)}
                  onFocus={() => setHoveredColor(c)}
                  onBlur={() => setHoveredColor(null)}
                  className={`w-6 h-6 rounded-full transition-all duration-200 ${
                    isSelected
                      ? "ring-2 ring-black ring-inset"
                      : "hover:scale-110"
                  } ${isWhite && !isSelected ? "border border-black/15" : ""}`}
                  style={swatchStyle}
                />
              );
            })}
            {visibleColors.length > 6 && (
              <span className="text-[10px] text-text-muted font-body">
                +{visibleColors.length - 6}
              </span>
            )}
          </div>
        )}

        {/* Prix — texte alternatif si non visible */}
        {!showPrices && (
          <div>
            {isRevokedConnected ? (
              <span
                className="inline-flex items-center gap-1.5 font-body text-[12px] text-red-600"
                title={t("revokedSeePricesDesc")}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" strokeWidth={1.8}>
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M8 12h8" />
                </svg>
                {t("revokedCardHint")}
              </span>
            ) : isPendingConnected ? (
              <span
                className="inline-flex items-center gap-1.5 font-body text-[12px] text-text-secondary"
                title={t("pendingSeePricesDesc")}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6v6l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t("pendingCardHint")}
              </span>
            ) : (
              <Link
                href="/connexion"
                className="inline-flex items-center gap-1.5 font-body text-[12px] text-text-secondary hover:text-text-primary underline-offset-4 hover:underline transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                {t("loginToSeePrices")}
              </Link>
            )}
          </div>
        )}

        {/* CTA principal — bouton uniquement pour clientes vérifiées */}
        {showPrices && (
          <div className="mt-auto pt-1">
            <button
              type="button"
              onClick={handleOpenModal}
              disabled={allOutOfStock}
              aria-label={t("addToCart")}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-[10px] tracking-[0.24em] uppercase font-medium border border-neutral-300 text-text-primary hover:bg-black hover:text-white hover:border-black transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-primary disabled:hover:border-neutral-300"
            >
              {allOutOfStock ? t("outOfStock") : t("addToCart")}
            </button>
          </div>
        )}
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
