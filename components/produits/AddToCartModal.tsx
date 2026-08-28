"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { addMultipleToCart } from "@/app/actions/client/cart";
import type { ClientDiscountInfo } from "./ProductCard";
import {
  pricePerUnit,
  applyDiscount,
  effectiveStock as effectiveStockOf,
  computeCartSummary,
} from "@/lib/add-to-cart-pricing";

// Règle métier : jamais d'arrondi à la hausse, on tronque au centime.
function floor2(n: number): number {
  return Math.floor(n * 100) / 100;
}

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

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [zoomImage, setZoomImage] = useState<{ src: string; alt: string } | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const firstColorImageRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) setFeedback(null);
  }, [isOpen]);

  // ESC : ferme le zoom en priorité, sinon la modale.
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (zoomImage) {
        setZoomImage(null);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, zoomImage]);

  useEffect(() => {
    if (!isOpen) setZoomImage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Ordre : couleur principale d'abord, puis les autres.
  const orderedColors = useMemo(() => {
    const primary = colors.filter((c) => c.isPrimary);
    const rest = colors.filter((c) => !c.isPrimary);
    return [...primary, ...rest];
  }, [colors]);

  const headerImage =
    orderedColors[0]?.firstImage ??
    colors.find((c) => c.firstImage)?.firstImage ??
    null;

  // Une couleur = un bloc contenant plusieurs options (Unité, Paquet de X…).
  interface SaleOption {
    key: string;
    label: string;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    variants: VariantData[];
  }
  const optionsByColorKey = useMemo(() => {
    const result = new Map<string, SaleOption[]>();
    for (const color of orderedColors) {
      const map = new Map<string, SaleOption>();
      for (const v of color.variants) {
        const key = v.saleType === "UNIT" ? "UNIT" : `PACK:${v.packQuantity ?? 0}`;
        if (map.has(key)) {
          map.get(key)!.variants.push(v);
        } else {
          const label = v.saleType === "UNIT"
            ? t("unit")
            : v.packQuantity ? t("packOf", { qty: v.packQuantity }) : "Pack";
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

  const { totalItems, totalPacks, totalPrice } = useMemo(
    () => computeCartSummary(colors, quantities, discountPercent, clientDiscount),
    [colors, quantities, discountPercent, clientDiscount],
  );

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
          setFeedback(null);
          setQuantities({});
          if (firstColorImageRef.current && headerImage) {
            const rect = firstColorImageRef.current.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent("cart:item-added", {
              detail: {
                imageSrc: headerImage,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                quantity: totalQty,
              },
            }));
          } else {
            window.dispatchEvent(new CustomEvent("cart:refresh"));
          }
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
      className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("chooseOptionsTitle")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-primary w-full h-full sm:h-auto sm:max-w-3xl sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header : titre + fermer */}
        <div className="p-4 sm:p-5 border-b border-border-light flex items-start gap-3 sm:gap-4 shrink-0 bg-gradient-to-r from-bg-secondary to-bg-primary">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs text-text-muted uppercase tracking-[0.15em] font-body mb-1">
              {tc(category)}{subCategory && <> · {tc(subCategory)}</>}
            </p>
            <h3 className="text-[15px] sm:text-lg font-semibold text-text-primary line-clamp-2 leading-tight font-heading">
              {tp(productName)}
            </h3>
            <p className="text-[11px] sm:text-xs text-text-muted font-mono mt-1">
              {t("reference")} : {productReference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="text-text-muted hover:text-text-primary shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary transition-colors"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body : une section par couleur, très visuellement séparées */}
        <div className="flex-1 overflow-y-auto">
          {orderedColors.length === 0 && (
            <p className="text-sm sm:text-base text-text-muted text-center py-8 px-4">{t("errorNoOption")}</p>
          )}
          {orderedColors.map((color, colorIdx) => {
            const options = optionsByColorKey.get(color.groupKey) ?? [];
            // Le rond de couleur (pastille) et la barre verticale à gauche
            // partagent la MÊME couleur (hex ou motif) que la variante.
            const swatchStyle: React.CSSProperties = color.patternImage
              ? { backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
              : { backgroundColor: color.hex ?? "#9CA3AF" };
            const isEven = colorIdx % 2 === 0;
            return (
              <div key={color.groupKey}>
                {/* Gros séparateur horizontal entre blocs de couleurs */}
                {colorIdx > 0 && (
                  <div className="h-3 bg-gradient-to-r from-bg-secondary via-border to-bg-secondary" aria-hidden="true" />
                )}
                <section
                  className={`relative pl-6 sm:pl-7 pr-4 sm:pr-5 py-4 sm:py-5 ${
                    isEven ? "bg-bg-primary" : "bg-bg-secondary"
                  }`}
                  aria-label={tp(color.name)}
                >
                  {/* Barre verticale à gauche = couleur/motif de la variante. */}
                  <span
                    className="absolute left-0 top-0 bottom-0 w-1.5 sm:w-2 shadow-[inset_-1px_0_0_rgba(0,0,0,0.08)]"
                    style={swatchStyle}
                    aria-hidden="true"
                  />
                  {/* En-tête couleur : pastille + nom + badge principale */}
                  <div className="flex items-center gap-2.5 sm:gap-3 mb-3 sm:mb-4">
                    <span
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-full shrink-0 ring-2 ring-white shadow-md"
                      style={swatchStyle}
                      aria-hidden="true"
                    />
                    <h4 className="text-[15px] sm:text-base font-semibold text-text-primary font-heading truncate">
                      {tp(color.name)}
                    </h4>
                    {color.isPrimary && (
                      <span className="text-[10px] uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-body shrink-0">
                        {t("mainColor")}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-3 sm:gap-4">
                    {/* Vignette cliquable → zoom */}
                    {color.firstImage ? (
                      <button
                        ref={colorIdx === 0 ? firstColorImageRef : undefined}
                        type="button"
                        onClick={() => setZoomImage({ src: color.firstImage!, alt: tp(color.name) })}
                        aria-label={t("preview")}
                        className="group/thumb relative shrink-0 w-24 h-32 sm:w-32 sm:h-40 rounded-xl overflow-hidden bg-bg-secondary shadow-md hover:shadow-xl transition-shadow cursor-zoom-in"
                      >
                        <Image
                          src={color.firstImage}
                          alt={tp(color.name)}
                          fill
                          sizes="(max-width: 640px) 96px, 128px"
                          className="object-cover transition-transform group-hover/thumb:scale-105"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 group-hover/thumb:bg-slate-900/25 transition-colors">
                          <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" />
                          </svg>
                        </span>
                        <span className="absolute bottom-1 right-1 bg-slate-900/70 text-white text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded font-body">
                          {t("zoom")}
                        </span>
                      </button>
                    ) : (
                      <div className="shrink-0 w-24 h-32 sm:w-32 sm:h-40 rounded-xl bg-bg-secondary flex items-center justify-center">
                        <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}

                    {/* Liste des options d'achat */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {options.length === 0 && (
                        <p className="text-xs sm:text-sm text-text-muted italic">{t("errorNoOption")}</p>
                      )}
                      {options.map((option) => (
                        option.variants.map((v) => {
                          const qty = quantities[v.id] ?? 0;
                          const unitPriceRaw = pricePerUnit(v);
                          const unitPriceFinal = floor2(applyDiscount(unitPriceRaw, discountPercent, clientDiscount));
                          const isPack = option.saleType === "PACK";
                          const packQty = option.packQuantity ?? 1;
                          const packPrice = floor2(unitPriceFinal * packQty);
                          const packPriceRaw = floor2(unitPriceRaw * packQty);
                          const effectiveStock = effectiveStockOf(v);
                          const outOfStock = effectiveStock <= 0;
                          const lineTotal = floor2(qty * (isPack ? packPrice : unitPriceFinal));
                          const active = qty > 0;
                          const hasDiscount = !!discountPercent && discountPercent > 0;
                          // Pour un PACK mono-taille, on garde le nom de la taille
                          // mais on omet le « ×qty » (déjà dans le badge « Paquet de X »).
                          const sizesLabel = v.sizes.length > 0
                            ? isPack && v.sizes.length === 1
                              ? v.sizes[0].name
                              : v.sizes.map((s) => s.name + (s.quantity > 1 ? ` ×${s.quantity}` : "")).join(" · ")
                            : null;
                          return (
                            <div
                              key={v.id}
                              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border transition-colors ${
                                outOfStock
                                  ? "border-border-light bg-bg-secondary/40 opacity-70"
                                  : active
                                    ? "border-2 border-emerald-400 bg-emerald-50/60"
                                    : "border-border bg-bg-primary hover:border-border-dark"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className={`inline-flex items-center text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold font-heading ${
                                    isPack
                                      ? active
                                        ? "bg-emerald-600 text-white"
                                        : "bg-bg-dark text-white"
                                      : "bg-slate-900 text-white"
                                  }`}>
                                    {option.label}
                                  </span>
                                  {sizesLabel && (
                                    <span className="text-[11px] sm:text-xs text-text-muted font-body truncate">
                                      {sizesLabel}
                                    </span>
                                  )}
                                  {outOfStock && (
                                    <span className="text-[11px] font-semibold text-error font-body">
                                      {t("outOfStock")}
                                    </span>
                                  )}
                                  {!outOfStock && (
                                    <span className="text-[10px] sm:text-[11px] text-text-muted font-body">
                                      {t("stockAvailable", { count: effectiveStock })}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] sm:text-xs text-text-muted font-body">
                                  {hasDiscount && (
                                    <>
                                      <span className="font-mono text-text-muted line-through mr-1">
                                        {unitPriceRaw.toFixed(2)} &euro;
                                      </span>
                                    </>
                                  )}
                                  <span className={`font-mono ${hasDiscount ? "text-error font-semibold" : "text-text-secondary"}`}>
                                    {unitPriceFinal.toFixed(2)} &euro;
                                  </span>
                                  {" "}{t("perUnit")}
                                  {isPack && (
                                    <>
                                      {" × "}{packQty}{" = "}
                                      {hasDiscount && (
                                        <span className="font-mono text-text-muted line-through mr-1">
                                          {packPriceRaw.toFixed(2)} &euro;
                                        </span>
                                      )}
                                      <span className={`font-mono ${hasDiscount ? "text-error font-semibold" : "text-text-secondary"}`}>
                                        {packPrice.toFixed(2)} &euro;
                                      </span>
                                      {" "}{t("perPack")}
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                                <div className={`flex items-center bg-bg-primary border rounded-lg overflow-hidden ${
                                  active ? "border-emerald-300" : "border-border"
                                } ${outOfStock ? "opacity-50" : ""}`}>
                                  <button
                                    type="button"
                                    aria-label={t("decrease")}
                                    onClick={() => setQty(v.id, qty - 1)}
                                    disabled={qty <= 0 || outOfStock}
                                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-text-muted hover:bg-bg-secondary disabled:opacity-30 text-lg font-bold"
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
                                    className={`w-10 sm:w-12 h-8 sm:h-9 text-center text-sm font-semibold bg-transparent outline-none font-body border-x border-border ${
                                      active ? "text-emerald-700" : "text-text-primary"
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    aria-label={t("increase")}
                                    onClick={() => setQty(v.id, qty + 1)}
                                    disabled={outOfStock || qty >= effectiveStock}
                                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-text-muted hover:bg-bg-secondary disabled:opacity-30 text-lg font-bold"
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="w-20 sm:w-24 text-right">
                                  <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-text-muted font-body">
                                    {t("total")}
                                  </div>
                                  <div className={`font-heading font-bold tabular-nums text-sm sm:text-base ${
                                    active ? "text-emerald-700" : outOfStock ? "text-text-muted" : "text-text-primary"
                                  }`}>
                                    {outOfStock && qty === 0 ? "—" : `${lineTotal.toFixed(2)} €`}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            );
          })}
        </div>

        {/* Footer récap + CTA */}
        <div className="p-4 sm:p-5 border-t border-border-light bg-bg-primary space-y-2 sm:space-y-3 shrink-0">
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
          <div className="flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted font-body">
                {t("summary")}
              </div>
              <div className="text-sm sm:text-base text-text-secondary font-body">
                {totalItems === 0 ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  <>
                    <span className="font-semibold text-text-primary">
                      {totalItems === 1 ? t("itemsCountOne", { count: totalItems }) : t("itemsCountOther", { count: totalItems })}
                    </span>
                    {totalPacks > 0 && (
                      <>
                        {" · "}
                        {totalPacks === 1 ? t("packsCountOne", { count: totalPacks }) : t("packsCountOther", { count: totalPacks })}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted font-body">
                {t("totalHT")}
              </div>
              <div className="font-heading font-bold text-xl sm:text-2xl text-text-primary tabular-nums">
                {floor2(totalPrice).toFixed(2)} &euro;
              </div>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || totalItems === 0 || justAdded}
              className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-white text-sm sm:text-base font-medium active:scale-[0.98] transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2 font-body shadow-lg ${
                justAdded
                  ? "bg-success"
                  : "bg-bg-dark hover:bg-slate-700 disabled:opacity-50"
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
      </div>

      {/* Zoom plein écran sur la vignette d'une couleur */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4 sm:p-6 animate-fade-in"
          onClick={(e) => {
            e.stopPropagation();
            setZoomImage(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t("preview")}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
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
              src={zoomImage.src}
              alt={zoomImage.alt}
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
