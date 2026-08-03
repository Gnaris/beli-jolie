"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { addMultipleToCart } from "@/app/actions/client/cart";
import type { ClientDiscountInfo } from "./ProductCard";

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

interface AddToCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  productReference: string;
  category: string;
  subCategory: string | null;
  colors: ColorData[];
  initialColorGroupKey?: string;
  discountPercent?: number | null;
  clientDiscount?: ClientDiscountInfo | null;
}

function pricePerUnit(v: VariantData): number {
  const p = Number(v.unitPrice);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) return p / v.packQuantity;
  return p;
}

function applyDiscount(
  price: number,
  productDiscountPercent?: number | null,
  clientDiscount?: ClientDiscountInfo | null,
): number {
  let p = price;
  if (productDiscountPercent && productDiscountPercent > 0) {
    p = Math.max(0, p * (1 - productDiscountPercent / 100));
  }
  if (clientDiscount) {
    if (clientDiscount.discountType === "PERCENT") {
      p = Math.max(0, p * (1 - clientDiscount.discountValue / 100));
    } else {
      p = Math.max(0, p - clientDiscount.discountValue);
    }
  }
  return p;
}

function formatVariantLabel(v: VariantData, tUnit: string): string {
  if (v.sizes.length === 0) return tUnit;
  return v.sizes.map((s) => s.name + (s.quantity > 1 ? ` ×${s.quantity}` : "")).join(", ");
}

export default function AddToCartModal({
  isOpen,
  onClose,
  productName,
  productReference,
  category,
  subCategory,
  colors,
  discountPercent,
  clientDiscount,
}: AddToCartModalProps) {
  const t = useTranslations("product");
  const { tp, tc } = useProductTranslation();
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Quantités par variantId (persistantes tant que le modal est ouvert)
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Lightbox pour l'image du produit
  const [showLightbox, setShowLightbox] = useState(false);
  // Feedback bouton "Ajouté !" 2 sec + point de départ de l'animation fly-to-cart
  const [justAdded, setJustAdded] = useState(false);
  const headerImageRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  // Réinitialiser feedback quand on rouvre
  useEffect(() => {
    if (isOpen) setFeedback(null);
  }, [isOpen]);

  // Fermeture par ESC : priorité lightbox > modal
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showLightbox) {
        setShowLightbox(false);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, showLightbox]);

  // Ferme la lightbox si le modal se ferme
  useEffect(() => {
    if (!isOpen) setShowLightbox(false);
  }, [isOpen]);

  // Empêcher le scroll du body derrière le modal
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Ordre d'affichage : la couleur principale (isPrimary) d'abord, puis les autres
  // dans l'ordre d'origine — plus intuitif pour la cliente qui met en avant sa couleur phare.
  const orderedColors = useMemo(() => {
    const primary = colors.filter((c) => c.isPrimary);
    const rest = colors.filter((c) => !c.isPrimary);
    return [...primary, ...rest];
  }, [colors]);

  // Image utilisée pour le header du modal + point de départ de l'animation fly-to-cart :
  // la couleur principale, à défaut la première ayant une image.
  const headerImage =
    orderedColors[0]?.firstImage ??
    colors.find((c) => c.firstImage)?.firstImage ??
    null;
  const headerColorName = orderedColors[0]?.name ?? null;

  // Regroupement des variantes par type de vente, calculé pour CHAQUE couleur.
  interface SaleGroup {
    key: string;
    label: string;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    variants: VariantData[];
  }
  const saleGroupsByColorKey = useMemo(() => {
    const result = new Map<string, SaleGroup[]>();
    for (const color of orderedColors) {
      const map = new Map<string, SaleGroup>();
      for (const v of color.variants) {
        const key = v.saleType === "UNIT" ? "UNIT" : `PACK:${v.packQuantity ?? 0}`;
        if (map.has(key)) {
          map.get(key)!.variants.push(v);
        } else {
          const label = v.saleType === "UNIT"
            ? t("unit")
            : v.packQuantity ? `Pack ×${v.packQuantity}` : "Pack";
          map.set(key, { key, label, saleType: v.saleType, packQuantity: v.packQuantity, variants: [v] });
        }
      }
      const arr = Array.from(map.values());
      arr.sort((a, b) => {
        if (a.saleType !== b.saleType) return a.saleType === "UNIT" ? -1 : 1;
        return (a.packQuantity ?? 0) - (b.packQuantity ?? 0);
      });
      result.set(color.groupKey, arr);
    }
    return result;
  }, [orderedColors, t]);

  // Totaux globaux (toutes couleurs / tous variants confondus)
  const totalItems = Object.values(quantities).reduce((s, n) => s + n, 0);
  const totalPrice = useMemo(() => {
    let sum = 0;
    for (const c of colors) {
      for (const v of c.variants) {
        const qty = quantities[v.id] ?? 0;
        if (qty <= 0) continue;
        const unit = applyDiscount(pricePerUnit(v), discountPercent, clientDiscount);
        const packQty = v.saleType === "PACK" && v.packQuantity ? v.packQuantity : 1;
        sum += unit * packQty * qty;
      }
    }
    return sum;
  }, [colors, quantities, discountPercent, clientDiscount]);

  function setQty(variantId: string, next: number) {
    setQuantities((prev) => {
      const clamped = Math.max(0, next);
      if (clamped === 0) {
        const { [variantId]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [variantId]: clamped };
    });
  }

  function handleSubmit() {
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }));

    if (items.length === 0) {
      setFeedback({ type: "error", msg: t("addSelectionEmpty") });
      return;
    }

    const totalQty = items.reduce((s, it) => s + it.quantity, 0);

    startTransition(async () => {
      try {
        const res = await addMultipleToCart(items);
        if (res.errors.length > 0) {
          setFeedback({
            type: "error",
            msg: res.errors.map((e) => e.message).join(" · "),
          });
        } else {
          // Le feedback visuel de succès est porté par le bouton vert « Ajouté ! »
          // + l'animation fly-to-cart : plus besoin du message texte redondant.
          setFeedback(null);
          setQuantities({}); // reset pour permettre d'ajouter d'autres couleurs

          // Animation fly-to-cart : point de départ = image du header du modal
          if (headerImageRef.current && headerImage) {
            const rect = headerImageRef.current.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent("cart:item-added", {
              detail: {
                imageSrc: headerImage,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                quantity: totalQty,
              },
            }));
          } else {
            // Fallback : au moins bump le compteur
            window.dispatchEvent(new CustomEvent("cart:refresh"));
          }

          // Bouton vert "Ajouté !" pendant 2 sec
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 2000);
        }
      } catch (err) {
        setFeedback({
          type: "error",
          msg: err instanceof Error ? err.message : t("errorAddToCart"),
        });
      }
    });
  }

  if (!mounted || !isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("chooseOptionsTitle")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-primary w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border-light flex items-start gap-3 sm:gap-4 shrink-0">
          {headerImage ? (
            <button
              ref={headerImageRef}
              type="button"
              onClick={() => setShowLightbox(true)}
              aria-label={t("preview")}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-bg-secondary shrink-0 relative group/thumb cursor-zoom-in"
            >
              <Image src={headerImage} alt={headerColorName ? tp(headerColorName) : tp(productName)} fill sizes="(max-width: 640px) 64px, 80px" className="object-cover transition-transform group-hover/thumb:scale-110" />
              <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 group-hover/thumb:bg-slate-900/30 transition-colors">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" />
                </svg>
              </span>
            </button>
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-bg-secondary shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs text-text-muted uppercase tracking-wide font-body">
              {tc(category)}{subCategory && <> · {tc(subCategory)}</>}
            </p>
            <h3 className="text-[15px] sm:text-lg font-semibold text-text-primary line-clamp-2 leading-tight font-body">
              {tp(productName)}
            </h3>
            <p className="text-xs sm:text-xs text-text-muted font-mono mt-0.5">{productReference}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="text-text-muted hover:text-text-primary shrink-0 p-1"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body : une section par couleur, chaque section liste ses variantes groupées par type de vente */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6 sm:space-y-7">
          {orderedColors.length === 0 && (
            <p className="text-sm sm:text-base text-text-muted text-center py-8">{t("errorNoOption")}</p>
          )}
          {orderedColors.map((color, colorIdx) => {
            const groups = saleGroupsByColorKey.get(color.groupKey) ?? [];
            const swatchStyle: React.CSSProperties = color.patternImage
              ? { backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
              : { backgroundColor: color.hex ?? "#9CA3AF" };
            return (
              <section
                key={color.groupKey}
                className={colorIdx > 0 ? "pt-5 sm:pt-6 border-t border-border-light" : ""}
                aria-label={tp(color.name)}
              >
                {/* En-tête de section couleur : palette + nom */}
                <div className="flex items-center gap-2.5 sm:gap-3 mb-3 sm:mb-4">
                  <span
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full shrink-0 ring-1 ring-border shadow-sm"
                    style={swatchStyle}
                    aria-hidden="true"
                  />
                  <h4 className="text-[15px] sm:text-base font-semibold text-text-primary font-body truncate">
                    {tp(color.name)}
                  </h4>
                  {color.isPrimary && (
                    <span className="text-[10px] sm:text-[11px] uppercase tracking-wide text-text-muted font-body">
                      · {t("mainColor")}
                    </span>
                  )}
                </div>

                {groups.length === 0 && (
                  <p className="text-xs sm:text-sm text-text-muted italic">{t("errorNoOption")}</p>
                )}

                <div className="space-y-4 sm:space-y-5">
                  {groups.map((group) => {
                    const firstVariant = group.variants[0];
                    const unitPriceRaw = pricePerUnit(firstVariant);
                    const unitPriceFinal = applyDiscount(unitPriceRaw, discountPercent, clientDiscount);
                    const isPack = group.saleType === "PACK";
                    const packQty = group.packQuantity ?? 1;
                    const packPrice = unitPriceFinal * packQty;
                    return (
                      <div key={group.key}>
                <div className="flex items-baseline justify-between mb-2 sm:mb-3">
                  <p className="text-xs sm:text-sm uppercase tracking-wider font-semibold text-text-primary font-body">
                    {group.label}
                  </p>
                  <div className="text-right">
                    <p className="text-sm sm:text-base font-semibold text-text-primary font-body">
                      {(isPack ? packPrice : unitPriceFinal).toFixed(2)} &euro;{" "}
                      <span className="text-[11px] sm:text-xs text-text-muted font-normal">
                        {isPack ? t("perPack") : t("perUnit")}
                      </span>
                    </p>
                    {isPack && (
                      <p className="text-[11px] sm:text-xs text-text-muted font-body">
                        {t("perUnitNote", { price: unitPriceFinal.toFixed(2) })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  {group.variants.map((v) => {
                    const qty = quantities[v.id] ?? 0;
                    const effectiveStock = isPack && v.packQuantity
                      ? Math.floor(v.stock / v.packQuantity)
                      : v.stock;
                    const outOfStock = effectiveStock <= 0;
                    return (
                      <div
                        key={v.id}
                        className={`flex items-center justify-between rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 border ${
                          qty > 0
                            ? "bg-emerald-50 border-emerald-200"
                            : outOfStock
                              ? "bg-bg-secondary/60 border-border-light opacity-60"
                              : "bg-bg-secondary border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <span className="text-[13px] sm:text-sm font-medium text-text-primary font-body truncate">
                            {formatVariantLabel(v, t("unit"))}
                          </span>
                          <span className="text-[11px] sm:text-xs text-text-muted font-body shrink-0">
                            {outOfStock ? t("outOfStock") : t("stockAvailable", { count: effectiveStock })}
                          </span>
                        </div>
                        <div className={`flex items-center gap-0 bg-bg-primary rounded-full border ${
                          qty > 0 ? "border-emerald-300" : "border-border"
                        } shrink-0`}>
                          <button
                            type="button"
                            aria-label={t("decrease")}
                            onClick={() => setQty(v.id, qty - 1)}
                            disabled={qty <= 0}
                            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30 text-base"
                          >
                            &minus;
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            aria-label={t("quantity")}
                            disabled={outOfStock}
                            value={qty === 0 ? "" : String(qty)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9]/g, "");
                              if (raw === "") return setQty(v.id, 0);
                              const n = parseInt(raw, 10);
                              if (Number.isNaN(n)) return;
                              setQty(v.id, Math.min(n, effectiveStock));
                            }}
                            onFocus={(e) => e.target.select()}
                            placeholder="0"
                            className={`w-9 sm:w-10 text-center text-sm font-medium bg-transparent outline-none font-body ${
                              qty > 0 ? "text-emerald-700" : "text-text-primary"
                            }`}
                          />
                          <button
                            type="button"
                            aria-label={t("increase")}
                            onClick={() => setQty(v.id, qty + 1)}
                            disabled={outOfStock || qty >= effectiveStock}
                            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30 text-base"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-border-light bg-bg-secondary space-y-2 sm:space-y-3 shrink-0">
          {feedback && (
            <p
              className={`text-[13px] sm:text-sm font-body text-center rounded-lg py-1.5 px-2 ${
                feedback.type === "success"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}
              role="status"
            >
              {feedback.msg}
            </p>
          )}
          <div className="flex items-center justify-between text-[15px] sm:text-base font-body">
            <span className="text-text-secondary">
              {totalItems === 0
                ? "—"
                : totalItems === 1
                  ? t("itemsCountOne", { count: totalItems })
                  : t("itemsCountOther", { count: totalItems })}
            </span>
            <span className="font-semibold text-text-primary">
              {t("totalHT")} : {totalPrice.toFixed(2)} &euro;
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || totalItems === 0 || justAdded}
            className={`w-full py-3 sm:py-3 rounded-full text-white text-[15px] sm:text-base font-medium active:scale-[0.98] transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2 font-body ${
              justAdded
                ? "bg-success"
                : "bg-accent hover:bg-accent-dark disabled:opacity-50"
            }`}
          >
            {isPending ? (
              <svg className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : justAdded ? (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            )}
            {justAdded ? t("added") : t("addSelection")}
          </button>
        </div>
      </div>

      {/* Lightbox : image plein écran au-dessus du modal */}
      {showLightbox && headerImage && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-fade-in"
          onClick={(e) => {
            e.stopPropagation();
            setShowLightbox(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t("preview")}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowLightbox(false); }}
            aria-label={t("close")}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div
            className="relative w-full h-full max-w-4xl max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={headerImage}
              alt={headerColorName ? tp(headerColorName) : tp(productName)}
              fill
              sizes="(max-width: 640px) 100vw, 80vw"
              className="object-contain"
              priority
            />
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modal, document.body);
}
