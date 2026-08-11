"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "@/components/ui/SmartImage";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { setCartItemQuantity, clearCart } from "@/app/actions/client/cart";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";
import ColorDot from "@/components/ui/ColorDot";
import type { ProductMeta, ProductVariantMeta } from "@/app/actions/client/cart";
import { buildProductHandle } from "@/lib/product-url";

// ─────────────────────────────────────────────
// Contexte promotions serveur (source de vérité)
// ─────────────────────────────────────────────
type PromoInfo = {
  finalUnitPrice: number;
  savedPerUnit: number;
  displayPercent: number;
  promotionName: string | null;
  source: "none" | "product" | "promotion";
};
const PromoInfoContext = createContext<Record<string, PromoInfo>>({});
function usePromoInfo(itemId: string | null | undefined): PromoInfo | null {
  const map = useContext(PromoInfoContext);
  if (!itemId) return null;
  return map[itemId] ?? null;
}
function resolveItemFinalPrice(
  itemId: string | null | undefined,
  fallbackBase: number,
  fallbackDiscountPercent: number | null,
  map: Record<string, PromoInfo>,
): number {
  if (itemId && map[itemId]) return map[itemId].finalUnitPrice;
  return computeUnitPrice(fallbackBase, fallbackDiscountPercent);
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface VariantData {
  id: string;
  productId: string;
  colorId: string | null;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
  unitPrice: number;
  weight: number;
  stock: number;
  color: { name: string; hex: string | null; patternImage?: string | null } | null;
  packLines?: { colorName: string; colorHex: string | null; colorPatternImage?: string | null; sizes: { name: string; quantity: number }[] }[];
  product: {
    id: string;
    name: string;
    reference: string;
    discountPercent?: number | null;
    category: { name: string };
  };
}

interface CartItemData {
  id: string;
  quantity: number;
  variant: VariantData;
  variantImages: { path: string }[];
}

interface CartData {
  id: string;
  items: CartItemData[];
}

interface Props {
  cart: CartData | null;
  productsMeta: Record<string, ProductMeta>;
  minOrderHT: number;
  stripeReady?: boolean;
  /** Résultat serveur du moteur de promotions par cart-item-id. */
  promoInfoByItemId?: Record<string, PromoInfo>;
}

// ─────────────────────────────────────────────
// Helpers prix
// ─────────────────────────────────────────────

function computeUnitPrice(basePrice: number, discountPercent: number | null): number {
  if (!discountPercent || discountPercent <= 0) return basePrice;
  return Math.max(0, basePrice * (1 - discountPercent / 100));
}

// Libellé chip du type de vente : "Unité" ou "PACK ×N"
function saleTypeLabel(saleType: "UNIT" | "PACK", packQuantity: number | null, tCart: (k: string, v?: Record<string, string | number>) => string): string {
  if (saleType === "UNIT") return tCart("saleTypeUnit");
  if (packQuantity && packQuantity > 1) return `PACK ×${packQuantity}`;
  return "PACK";
}

// ─────────────────────────────────────────────
// Lightbox zoom image
// ─────────────────────────────────────────────

function ImageLightbox({ image, alt, onClose }: { image: string; alt: string; onClose: () => void }) {
  const t = useTranslations("cart");
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("zoomImage")}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur transition-colors"
        aria-label={t("closeZoom")}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Image cliquable avec hover assombri + loupe
// ─────────────────────────────────────────────

function ZoomableImage({
  src, alt, onZoom, sizeClass = "w-14 h-14",
}: { src: string | null; alt: string; onZoom: (src: string, alt: string) => void; sizeClass?: string }) {
  const t = useTranslations("cart");
  if (!src) {
    return (
      <div className={`${sizeClass} rounded-lg bg-bg-tertiary border border-border-light shrink-0 flex items-center justify-center text-text-muted`}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onZoom(src, alt)}
      className={`${sizeClass} rounded-lg overflow-hidden bg-bg-tertiary border border-border-light shrink-0 relative group/zoom cursor-zoom-in`}
      aria-label={t("zoomImage")}
      title={t("zoomImage")}
    >
      <Image src={src} alt={alt} width={112} height={112} sizes="112px" className="w-full h-full object-cover" />
      <span className="absolute inset-0 bg-black/0 group-hover/zoom:bg-black/45 transition-colors" aria-hidden="true" />
      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/zoom:opacity-100 transition-opacity" aria-hidden="true">
        <span className="w-7 h-7 rounded-full bg-white/95 shadow-md flex items-center justify-center text-text-primary">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m-3-3h6" />
          </svg>
        </span>
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────
// Rail vertical desktop
// ─────────────────────────────────────────────

function RailStepper({ currentStep }: { currentStep: number }) {
  const t = useTranslations("cart");
  const steps = [
    { label: t("stepCart") },
    { label: t("stepInfo") },
    { label: t("stepPayment") },
  ];
  return (
    <div className="rail-stepper h-full flex flex-col items-center py-10 px-5 gap-9">
      <div className="w-11 h-11 rounded-xl bg-white text-bg-dark flex items-center justify-center font-heading font-bold text-lg mb-4">B</div>
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <div key={step.label} className="flex flex-col items-center gap-2 relative">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-heading text-sm font-semibold shrink-0 transition-all ${
                isActive
                  ? "bg-white text-bg-dark shadow-[0_0_0_4px_rgba(255,255,255,0.15)]"
                  : isDone
                    ? "bg-text-secondary text-white"
                    : "border border-dashed border-white/30 text-white/50"
              }`}
            >
              {isDone ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (i + 1)}
            </div>
            <div className={`text-[10px] uppercase tracking-wider text-center leading-snug px-1 ${isActive ? "text-white font-semibold" : isDone ? "text-white/70" : "text-white/40"}`}>
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <div className="absolute top-[56px] left-1/2 -translate-x-1/2 w-px h-8 bg-white/10" aria-hidden="true" />
            )}
          </div>
        );
      })}
      <div className="mt-auto text-[10px] text-white/40 tracking-widest flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        SSL
      </div>
    </div>
  );
}

function MobileProgress({ currentStep }: { currentStep: number }) {
  const t = useTranslations("cart");
  const labels = [t("stepCart"), t("stepInfo"), t("stepPayment")];
  return (
    <div className="lg:hidden mb-5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest mb-2">
        <span className="text-text-primary font-semibold">{labels[currentStep]}</span>
        <span className="text-text-muted">{t("stepIndicator", { current: currentStep + 1, total: 3 })}</span>
      </div>
      <div className="flex gap-1" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={3}>
        {labels.map((_, i) => (
          <div key={i} className={`flex-1 h-1 rounded ${
            i < currentStep ? "bg-text-secondary" : i === currentStep ? "bg-bg-dark" : "bg-border"
          }`} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Panneau récapitulatif
// ─────────────────────────────────────────────

function SummaryPanel({
  subtotal, minOrderHT, minReached, minProgress,
  stripeReady, showMinError, onCheckout, isPending, compact,
}: {
  subtotal: number;
  minOrderHT: number;
  minReached: boolean;
  minProgress: number;
  stripeReady: boolean;
  showMinError: boolean;
  onCheckout: () => void;
  isPending: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("cart");
  return (
    <div className={compact ? "" : "p-8 h-full flex flex-col"}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted mb-1">{t("summary")}</div>
      <div className="font-heading text-2xl font-bold text-text-primary mb-6">{t("yourOrder")}</div>

      {minOrderHT > 0 && (
        <div className={`mb-6 p-4 rounded-xl border ${minReached ? "bg-success-bg border-success/20" : "bg-warning-bg border-warning/20"}`}>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-xs uppercase tracking-wider text-text-secondary">{t("minOrderLabel")}</span>
            <span className={`font-heading text-sm font-semibold tabular-nums ${minReached ? "text-success" : "text-warning"}`}>
              {minReached ? t("minReached") : `${minProgress.toFixed(0)}%`}
            </span>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ease-out ${minReached ? "bg-success" : "bg-warning"}`} style={{ width: `${minProgress.toFixed(1)}%` }} />
          </div>
          {!minReached && (
            <p className="text-[11px] text-warning mt-2 font-medium">
              {t("minOrderRemaining", { remaining: (minOrderHT - subtotal).toFixed(2) })}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5 text-sm font-body">
        <div className="flex justify-between">
          <span className="text-text-secondary">{t("subtotalHT")}</span>
          <span className="font-medium text-text-primary tabular-nums">{subtotal.toFixed(2)} €</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>{t("shipping")}</span>
          <span className="text-xs italic">{t("shippingNextStep")}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>{t("tva")}</span>
          <span className="text-xs italic">{t("tvaNextStep")}</span>
        </div>
      </div>

      <div className="my-5 h-px bg-border" aria-hidden="true" />

      <div className="flex items-baseline justify-between mb-8">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-text-muted">{t("estimatedTotal")}</div>
          <div className="font-heading text-3xl font-bold text-text-primary tabular-nums">
            {subtotal.toFixed(2)} <span className="text-lg text-text-muted">€</span>
          </div>
        </div>
      </div>

      {showMinError && (
        <div className="flex items-start gap-2 bg-warning-bg border border-warning/30 rounded-xl px-3 py-2.5 text-xs font-body text-warning mb-3">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>{t("minNotReachedShort", { min: minOrderHT.toFixed(2) })}</span>
        </div>
      )}

      {!stripeReady && (
        <div className="flex items-start gap-2 bg-error-bg border border-error/20 rounded-xl px-3 py-2.5 text-xs font-body text-error mb-3">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>{t("noPaymentMethod")}</span>
        </div>
      )}

      <button
        type="button"
        disabled={!stripeReady || isPending}
        onClick={onCheckout}
        className="btn-primary w-full justify-center h-12 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t("checkout")}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </button>

      <Link href="/produits" className="text-xs font-body text-text-muted hover:text-text-primary transition-colors flex items-center justify-center gap-1.5 py-2 mt-2">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        {t("continueShopping")}
      </Link>

      {!compact && (
        <div className="mt-auto pt-6 border-t border-border space-y-2 text-[11px] text-text-muted">
          <div className="flex items-start gap-2"><span className="text-success shrink-0">✓</span><span>{t("trustPrices")}</span></div>
          <div className="flex items-start gap-2"><span className="text-text-primary shrink-0">✦</span><span>{t("trustSupport")}</span></div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Ligne variante (dans la table accordion)
// ─────────────────────────────────────────────

interface VariantRowProps {
  productId: string;
  variant: ProductVariantMeta;
  currentQty: number;
  onSetQty: (variantId: string, qty: number) => Promise<void>;
  onZoom: (src: string, alt: string) => void;
  discountPercent: number | null;
  productName: string;
  isFirstOfColor: boolean;      // pour rowspan image + couleur
  colorRowSpan: number;           // rowspan
  rowIndex: number;
  totalRowsForColor: number;
  isMobile?: boolean;
}

function VariantRow({
  productId, variant, currentQty, onSetQty, onZoom,
  discountPercent, productName, isFirstOfColor, colorRowSpan, rowIndex, totalRowsForColor,
}: VariantRowProps) {
  void productId;
  void rowIndex;
  void totalRowsForColor;
  const tCart = useTranslations("cart");
  const { tp } = useProductTranslation();
  const [qtyDraft, setQtyDraft] = useState(String(currentQty));
  const dirtyRef = useRef(false);  // true dès qu'un clic +/- a modifié la valeur locale sans être encore commit
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync depuis les props uniquement si l'utilisateur n'a pas de modif en cours
  useEffect(() => {
    if (!dirtyRef.current) setQtyDraft(String(currentQty));
  }, [currentQty]);

  // Nettoyage debounce à l'unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const unitPrice = computeUnitPrice(variant.unitPrice, discountPercent);
  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
    ? Math.floor(variant.stock / variant.packQuantity)
    : variant.stock;
  const isOutOfStock = effectiveStock <= 0;
  const displayQty = parseInt(qtyDraft, 10) || 0;
  const isCommanded = displayQty > 0;
  const lineTotal = unitPrice * displayQty;
  const unitsCount = variant.saleType === "PACK" && variant.packQuantity
    ? displayQty * variant.packQuantity
    : displayQty;

  function scheduleServerUpdate(newQty: number) {
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await onSetQty(variant.variantId, newQty);
      dirtyRef.current = false;
    }, 400);
  }

  function bump(delta: 1 | -1) {
    const current = parseInt(qtyDraft, 10) || 0;
    let next = current + delta;
    if (next < 0) next = 0;
    if (next > effectiveStock) next = effectiveStock;
    if (next === current) return;
    setQtyDraft(String(next));
    scheduleServerUpdate(next);
  }

  function commitQty() {
    const parsed = parseInt(qtyDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setQtyDraft(String(currentQty));
      dirtyRef.current = false;
      return;
    }
    const capped = Math.min(parsed, effectiveStock);
    if (capped !== parsed) setQtyDraft(String(capped));
    if (capped === currentQty) {
      dirtyRef.current = false;
      return;
    }
    scheduleServerUpdate(capped);
  }

  const rowClass = isOutOfStock
    ? "opacity-40"
    : isCommanded ? "" : "opacity-70";

  const chipClass = variant.saleType === "UNIT"
    ? "chip-unit"
    : "chip-pack";

  return (
    <tr className={`${rowClass} hover:bg-white transition-colors ${isFirstOfColor ? "border-t border-border" : ""}`}>
      {/* Image (rowspan si première variante de cette couleur) */}
      {isFirstOfColor && (
        <td className="px-4 py-2 align-top" rowSpan={colorRowSpan}>
          <ZoomableImage
            src={variant.firstImagePath}
            alt={`${tp(productName)} · ${tp(variant.colorName)}`}
            onZoom={onZoom}
            sizeClass="w-12 h-12"
          />
        </td>
      )}
      {/* Couleur (rowspan) */}
      {isFirstOfColor && (
        <td className="px-2 py-2 align-top" rowSpan={colorRowSpan}>
          <div className="flex items-center gap-2 pt-1">
            <ColorDot color={{ name: tp(variant.colorName), hex: variant.colorHex, patternImage: variant.colorPatternImage }} size={16} />
            <span className={`text-sm font-body ${isCommanded ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
              {tp(variant.colorName)}
            </span>
          </div>
        </td>
      )}
      {/* Type de vente */}
      <td className="px-2 py-2">
        <span className={`chip ${chipClass}`}>
          {saleTypeLabel(variant.saleType, variant.packQuantity, tCart)}
        </span>
      </td>
      {/* Prix */}
      <td className="text-right px-2 py-2 text-xs text-text-secondary">
        {unitPrice.toFixed(2)} €
        {variant.saleType === "PACK" && variant.packQuantity && (
          <span className="block text-[10px] text-text-muted">
            {(unitPrice / variant.packQuantity).toFixed(2)} € / u.
          </span>
        )}
      </td>
      {/* Qté (input) */}
      <td className="px-2 py-2">
        {isOutOfStock ? (
          <div className="flex items-center justify-center gap-1.5">
            <span className="chip text-[10px] text-text-muted">{tCart("outOfStock")}</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-0.5">
            <button
              type="button"
              onClick={() => bump(-1)}
              className="qty text-xs disabled:opacity-30"
              disabled={displayQty <= 0}
              aria-label={tCart("decrement")}
            >−</button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={qtyDraft}
              onChange={(e) => { dirtyRef.current = true; setQtyDraft(e.target.value.replace(/[^0-9]/g, "")); }}
              onBlur={commitQty}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              onFocus={(e) => e.target.select()}
              className={`qty-input w-10 h-7 text-center text-sm font-semibold font-body tabular-nums bg-white border border-border rounded-md focus:outline-none focus:border-bg-dark ${displayQty === 0 ? "text-text-muted" : "text-text-primary"}`}
              aria-label={tCart("quantity")}
            />
            <button
              type="button"
              onClick={() => bump(1)}
              className="qty text-xs"
              disabled={displayQty >= effectiveStock}
              aria-label={tCart("increment")}
            >+</button>
          </div>
        )}
      </td>
      {/* Unités */}
      <td className="text-right px-2 py-2 text-xs text-text-secondary tabular-nums">
        {unitsCount || "—"}
      </td>
      {/* Sous-total */}
      <td className="text-right px-4 py-2">
        {isCommanded ? (
          <span className="font-heading font-bold text-sm text-text-primary tabular-nums">{lineTotal.toFixed(2)} €</span>
        ) : (
          <span className="text-xs text-text-muted tabular-nums">0,00 €</span>
        )}
      </td>
    </tr>
  );
}

// Style CSS pour qty (dupliqué depuis avant, on garde) — utilisé via classes locales

// ─────────────────────────────────────────────
// Card produit (accordion)
// ─────────────────────────────────────────────

interface ProductGroupCardProps {
  meta: ProductMeta;
  itemsByVariantId: Map<string, CartItemData>;
  multiColorPackItems: CartItemData[];  // items PACK multi-couleurs pour ce produit (traités séparément)
  onSetQty: (variantId: string, qty: number) => Promise<void>;
  onZoom: (src: string, alt: string) => void;
  onRemoveProduct: (productId: string) => void;
}

function ProductGroupCard({
  meta, itemsByVariantId, multiColorPackItems, onSetQty, onZoom, onRemoveProduct,
}: ProductGroupCardProps) {
  const tCart = useTranslations("cart");
  const { tp, tc: translateCat } = useProductTranslation();

  // Regrouper variantes par colorId (avec fallback vers variantId si colorId null)
  const variantsByColor = useMemo(() => {
    const map = new Map<string, ProductVariantMeta[]>();
    for (const v of meta.variants) {
      const key = v.colorId ?? `_novariant_${v.variantId}`;
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    // Sort chaque groupe par saleType (UNIT avant PACK, puis packQuantity croissant)
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.saleType !== b.saleType) return a.saleType === "UNIT" ? -1 : 1;
        return (a.packQuantity ?? 0) - (b.packQuantity ?? 0);
      });
    }
    return map;
  }, [meta.variants]);

  // Calcul total produit (toutes variantes commandées) + total unités
  const { totalProduct, totalUnits, orderedCount, orderedColors } = useMemo(() => {
    let total = 0;
    let units = 0;
    let ordered = 0;
    const colorsOrdered = new Set<string>();
    for (const v of meta.variants) {
      const item = itemsByVariantId.get(v.variantId);
      if (!item || item.quantity <= 0) continue;
      const price = computeUnitPrice(v.unitPrice, meta.discountPercent);
      total += price * item.quantity;
      units += v.saleType === "PACK" && v.packQuantity
        ? item.quantity * v.packQuantity
        : item.quantity;
      ordered++;
      if (v.colorId) colorsOrdered.add(v.colorId);
    }
    // Ajouter les items multi-couleurs pack
    for (const item of multiColorPackItems) {
      const price = computeUnitPrice(item.variant.unitPrice, meta.discountPercent);
      total += price * item.quantity;
      units += (item.variant.packQuantity ?? 1) * item.quantity;
      ordered++;
    }
    return { totalProduct: total, totalUnits: units, orderedCount: ordered, orderedColors: colorsOrdered.size };
  }, [meta.variants, meta.discountPercent, itemsByVariantId, multiColorPackItems]);

  const totalAvailableVariants = meta.variants.length;
  const hasDiscount = meta.discountPercent != null && meta.discountPercent > 0;

  return (
    <details className="group/prod bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden" open={orderedCount > 0}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="grid grid-cols-[112px_1fr_auto] md:grid-cols-[112px_1fr_auto_140px_auto] gap-3 md:gap-4 items-center p-4 hover:bg-bg-secondary/50 transition-colors">
          {/* Image produit */}
          <div className="relative shrink-0">
            <ZoomableImage
              src={meta.mainImagePath}
              alt={tp(meta.productName)}
              onZoom={onZoom}
              sizeClass="w-28 h-28"
            />
            {hasDiscount && (
              <span className="absolute -top-1 -left-1 z-10 text-[10px] font-bold text-white bg-error px-1.5 py-0.5 rounded pointer-events-none">
                -{meta.discountPercent}%
              </span>
            )}
          </div>

          {/* Nom + ref + chips + résumé pastilles */}
          <div className="min-w-0">
            <span className="text-sm md:text-base font-heading font-semibold text-text-primary block truncate">
              {tp(meta.productName)}
            </span>
            <p className="text-[11px] font-mono text-text-muted truncate">
              {meta.productReference} · {translateCat(meta.categoryName)}
            </p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {[...variantsByColor.entries()].map(([colorKey, list]) => {
                const head = list[0];
                const isCommanded = list.some((v) => (itemsByVariantId.get(v.variantId)?.quantity ?? 0) > 0);
                return (
                  <span
                    key={colorKey}
                    className={`inline-block rounded-full ${isCommanded ? "" : "opacity-40"}`}
                    title={tp(head.colorName)}
                  >
                    <ColorDot color={{ name: tp(head.colorName), hex: head.colorHex, patternImage: head.colorPatternImage }} size={12} />
                  </span>
                );
              })}
              <span className="text-[11px] text-text-secondary ml-2">
                {tCart("colorsOrderedOn", { ordered: orderedColors, total: variantsByColor.size })}
                {totalUnits > 0 && ` · ${totalUnits} ${totalUnits > 1 ? tCart("units_plural") : tCart("units")}`}
              </span>
            </div>
          </div>

          {/* Voir la fiche */}
          <Link
            href={`/produits/${buildProductHandle(meta.productName, meta.productReference)}`}
            onClick={(e) => e.stopPropagation()}
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary underline decoration-dotted"
            title={tCart("viewProductPage")}
            aria-label={tCart("viewProductPage")}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {tCart("viewProductShort")}
          </Link>

          {/* Total + chevron */}
          <div className="hidden md:block text-right">
            {orderedCount > 0 ? (
              <>
                <div className="font-heading font-bold text-text-primary text-sm md:text-base tabular-nums">{totalProduct.toFixed(2)} €</div>
                <div className="text-[10px] text-text-muted">{orderedCount} {orderedCount > 1 ? tCart("linesOrdered_plural") : tCart("linesOrdered")}</div>
              </>
            ) : (
              <span className="text-xs text-text-muted italic">{tCart("nothingOrdered")}</span>
            )}
          </div>

          {/* Chevron */}
          <div className="flex flex-col items-end gap-1">
            <div className="md:hidden text-right">
              <div className="font-heading font-bold text-text-primary text-sm tabular-nums">{totalProduct.toFixed(2)} €</div>
            </div>
            <svg className="w-4 h-4 text-text-muted transition-transform group-open/prod:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </summary>

      {/* Table variantes (dépliée) */}
      <div className="bg-bg-secondary/40 border-t border-border">
        {/* Table desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-text-muted">
                <th className="text-left px-4 py-2 font-semibold w-16">{tCart("thImage")}</th>
                <th className="text-left px-2 py-2 font-semibold">{tCart("thColor")}</th>
                <th className="text-left px-2 py-2 font-semibold">{tCart("thSaleType")}</th>
                <th className="text-right px-2 py-2 font-semibold">{tCart("thPrice")}</th>
                <th className="text-center px-2 py-2 font-semibold w-32">{tCart("thQuantity")}</th>
                <th className="text-right px-2 py-2 font-semibold">{tCart("thUnits")}</th>
                <th className="text-right px-4 py-2 font-semibold">{tCart("thSubtotal")}</th>
              </tr>
            </thead>
            <tbody>
              {[...variantsByColor.entries()].map(([colorId, variantList]) => (
                variantList.map((variant, idx) => {
                  void colorId;
                  const currentItem = itemsByVariantId.get(variant.variantId);
                  return (
                    <VariantRow
                      key={variant.variantId}
                      productId={meta.productId}
                      variant={variant}
                      currentQty={currentItem?.quantity ?? 0}
                      onSetQty={onSetQty}
                      onZoom={onZoom}
                      discountPercent={meta.discountPercent}
                      productName={meta.productName}
                      isFirstOfColor={idx === 0}
                      colorRowSpan={variantList.length}
                      rowIndex={idx}
                      totalRowsForColor={variantList.length}
                    />
                  );
                })
              ))}
              {/* Items PACK multi-couleurs (préservés en format classique) */}
              {multiColorPackItems.map((item) => (
                <MultiColorPackRow key={item.id} item={item} discountPercent={meta.discountPercent} onSetQty={onSetQty} onZoom={onZoom} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Version mobile compacte */}
        <div className="md:hidden divide-y divide-border">
          {[...variantsByColor.entries()].map(([colorId, variantList]) => (
            <div key={colorId} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <ZoomableImage src={variantList[0].firstImagePath} alt={tp(variantList[0].colorName)} onZoom={onZoom} sizeClass="w-12 h-12" />
                <div className="flex items-center gap-1.5">
                  <ColorDot color={{ name: tp(variantList[0].colorName), hex: variantList[0].colorHex, patternImage: variantList[0].colorPatternImage }} size={14} />
                  <span className="text-sm font-body font-semibold text-text-primary">{tp(variantList[0].colorName)}</span>
                </div>
              </div>
              <div className="space-y-2 pl-14">
                {variantList.map((variant) => {
                  const currentItem = itemsByVariantId.get(variant.variantId);
                  const currentQty = currentItem?.quantity ?? 0;
                  const price = computeUnitPrice(variant.unitPrice, meta.discountPercent);
                  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
                    ? Math.floor(variant.stock / variant.packQuantity)
                    : variant.stock;
                  const isOutOfStock = effectiveStock <= 0;
                  const total = price * currentQty;
                  return (
                    <div key={variant.variantId} className="flex items-center gap-2 text-xs">
                      <span className={`chip ${variant.saleType === "UNIT" ? "chip-unit" : "chip-pack"} shrink-0`}>
                        {saleTypeLabel(variant.saleType, variant.packQuantity, tCart)}
                      </span>
                      <span className="text-text-muted shrink-0">{price.toFixed(2)} €</span>
                      {isOutOfStock ? (
                        <span className="chip text-[10px] text-text-muted ml-auto">{tCart("outOfStock")}</span>
                      ) : (
                        <>
                          <MobileQtyControl
                            value={currentQty}
                            onChange={(q) => onSetQty(variant.variantId, q)}
                            max={effectiveStock}
                            ariaLabel={tCart("quantity")}
                          />
                          <span className="ml-auto font-heading font-bold tabular-nums text-text-primary">
                            {currentQty > 0 ? `${total.toFixed(2)} €` : "—"}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {multiColorPackItems.map((item) => (
            <div key={item.id} className="p-3">
              <MultiColorPackRowMobile item={item} discountPercent={meta.discountPercent} onSetQty={onSetQty} onZoom={onZoom} />
            </div>
          ))}
        </div>

        {/* Footer produit : total + actions */}
        <div className="px-4 py-3 border-t border-border bg-bg-primary flex flex-wrap items-center gap-3 justify-between">
          <div className="text-xs text-text-muted">
            {orderedCount > 0
              ? tCart("productTotal", { total: totalProduct.toFixed(2), units: totalUnits })
              : tCart("emptyProduct")}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/produits/${buildProductHandle(meta.productName, meta.productReference)}`}
              className="md:hidden inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary underline decoration-dotted"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              {tCart("viewProductShort")}
            </Link>
            {orderedCount > 0 && (
              <button
                type="button"
                onClick={() => onRemoveProduct(meta.productId)}
                className="text-[11px] text-text-muted hover:text-error underline decoration-dotted"
              >
                {tCart("removeAllProduct")}
              </button>
            )}
          </div>
        </div>
        <div className="text-[9px] text-text-muted px-4 pb-3 pt-1 italic">
          {tCart("availableVariantsCount", { count: totalAvailableVariants })}
        </div>
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────
// Multi-color pack (format hérité : une ligne)
// ─────────────────────────────────────────────

function MultiColorPackRow({
  item, discountPercent, onSetQty, onZoom,
}: {
  item: CartItemData;
  discountPercent: number | null;
  onSetQty: (variantId: string, qty: number) => Promise<void>;
  onZoom: (src: string, alt: string) => void;
}) {
  const tCart = useTranslations("cart");
  const { tp } = useProductTranslation();
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity));
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!dirtyRef.current) setQtyDraft(String(item.quantity)); }, [item.quantity]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const price = computeUnitPrice(item.variant.unitPrice, discountPercent);
  const displayQty = parseInt(qtyDraft, 10) || 0;
  const total = price * displayQty;
  const image = item.variantImages[0]?.path ?? null;

  function scheduleServerUpdate(newQty: number) {
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await onSetQty(item.variant.id, newQty);
      dirtyRef.current = false;
    }, 400);
  }

  function bump(delta: 1 | -1) {
    const current = parseInt(qtyDraft, 10) || 0;
    const next = Math.max(0, current + delta);
    if (next === current) return;
    setQtyDraft(String(next));
    scheduleServerUpdate(next);
  }

  function commitQty() {
    const parsed = parseInt(qtyDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setQtyDraft(String(item.quantity));
      dirtyRef.current = false;
      return;
    }
    if (parsed === item.quantity) { dirtyRef.current = false; return; }
    scheduleServerUpdate(parsed);
  }

  return (
    <tr className="border-t border-border hover:bg-white">
      <td className="px-4 py-2"><ZoomableImage src={image} alt={tp(item.variant.product.name)} onZoom={onZoom} sizeClass="w-12 h-12" /></td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          {item.variant.packLines?.map((line, i) => (
            <ColorDot key={i} color={{ name: tp(line.colorName), hex: line.colorHex, patternImage: line.colorPatternImage }} size={14} />
          ))}
        </div>
        <span className="text-[10px] text-text-muted mt-1 block">{tCart("multiColorPack")}</span>
      </td>
      <td className="px-2 py-2"><span className="chip chip-pack">PACK ×{item.variant.packQuantity ?? "—"}</span></td>
      <td className="text-right px-2 py-2 text-xs text-text-secondary">{price.toFixed(2)} €</td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-center gap-0.5">
          <button type="button" onClick={() => bump(-1)} className="qty text-xs" disabled={displayQty <= 0}>−</button>
          <input
            type="text"
            inputMode="numeric"
            value={qtyDraft}
            onChange={(e) => { dirtyRef.current = true; setQtyDraft(e.target.value.replace(/[^0-9]/g, "")); }}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
            onFocus={(e) => e.target.select()}
            className="w-10 h-7 text-center text-sm font-semibold text-text-primary font-body tabular-nums bg-white border border-border rounded-md focus:outline-none focus:border-bg-dark"
          />
          <button type="button" onClick={() => bump(1)} className="qty text-xs">+</button>
        </div>
      </td>
      <td className="text-right px-2 py-2 text-xs text-text-secondary tabular-nums">
        {(displayQty * (item.variant.packQuantity ?? 1))}
      </td>
      <td className="text-right px-4 py-2"><span className="font-heading font-bold text-sm text-text-primary tabular-nums">{total.toFixed(2)} €</span></td>
    </tr>
  );
}

function MultiColorPackRowMobile({
  item, discountPercent, onSetQty, onZoom,
}: {
  item: CartItemData;
  discountPercent: number | null;
  onSetQty: (variantId: string, qty: number) => Promise<void>;
  onZoom: (src: string, alt: string) => void;
}) {
  const tCart = useTranslations("cart");
  const { tp } = useProductTranslation();
  const price = computeUnitPrice(item.variant.unitPrice, discountPercent);
  const total = price * item.quantity;
  const image = item.variantImages[0]?.path ?? null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <ZoomableImage src={image} alt={tp(item.variant.product.name)} onZoom={onZoom} sizeClass="w-12 h-12" />
        <div className="flex-1">
          <div className="flex items-center gap-1">
            {item.variant.packLines?.map((line, i) => (
              <ColorDot key={i} color={{ name: tp(line.colorName), hex: line.colorHex, patternImage: line.colorPatternImage }} size={12} />
            ))}
            <span className="text-[10px] text-text-muted ml-1">{tCart("multiColorPack")}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs pl-14">
        <span className="chip chip-pack shrink-0">PACK ×{item.variant.packQuantity ?? "—"}</span>
        <span className="text-text-muted shrink-0">{price.toFixed(2)} €</span>
        <MobileQtyControl value={item.quantity} onChange={(q) => onSetQty(item.variant.id, q)} max={999} ariaLabel={tCart("quantity")} />
        <span className="ml-auto font-heading font-bold tabular-nums text-text-primary">{total.toFixed(2)} €</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Contrôle qty mobile compact
// ─────────────────────────────────────────────

function MobileQtyControl({
  value, onChange, max, ariaLabel,
}: { value: number; onChange: (q: number) => void; max: number; ariaLabel: string }) {
  // Optimistic local state + debounce (même approche que VariantRow)
  const [local, setLocal] = useState(value);
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!dirtyRef.current) setLocal(value); }, [value]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  function bump(delta: 1 | -1) {
    let next = local + delta;
    if (next < 0) next = 0;
    if (next > max) next = max;
    if (next === local) return;
    setLocal(next);
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(next);
      dirtyRef.current = false;
    }, 400);
  }
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={() => bump(-1)} className="qty text-xs" disabled={local <= 0}>−</button>
      <span className="w-8 text-center text-xs font-semibold tabular-nums" aria-label={ariaLabel}>{local}</span>
      <button type="button" onClick={() => bump(1)} className="qty text-xs" disabled={local >= max}>+</button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────

export default function CartPageClient({ cart, productsMeta, minOrderHT, stripeReady = true, promoInfoByItemId = {} }: Props) {
  const t = useTranslations("cart");
  const { tp } = useProductTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();
  const [showClearModal, setShowClearModal] = useState(false);
  const [showMinError, setShowMinError] = useState(false);
  const [query, setQuery] = useState("");
  const [lightbox, setLightbox] = useState<{ image: string; alt: string } | null>(null);
  const backdropClearModal = useBackdropClose(() => setShowClearModal(false));

  const handleZoom = (image: string, alt: string) => setLightbox({ image, alt });

  const allItems = cart?.items ?? [];

  // Map cartItem par variantId pour lookup rapide
  const itemsByVariantId = useMemo(() => {
    const m = new Map<string, CartItemData>();
    for (const item of allItems) m.set(item.variant.id, item);
    return m;
  }, [allItems]);

  // Grouper items multi-couleur pack par produit (traités séparément dans les cards)
  const multiColorPackItemsByProduct = useMemo(() => {
    const m = new Map<string, CartItemData[]>();
    for (const item of allItems) {
      if (item.variant.saleType === "PACK" && item.variant.packLines && item.variant.packLines.length > 0) {
        const list = m.get(item.variant.productId) ?? [];
        list.push(item);
        m.set(item.variant.productId, list);
      }
    }
    return m;
  }, [allItems]);

  // Liste des produits triés par catégorie puis nom
  const productsList = useMemo(() => {
    return Object.values(productsMeta).sort((a, b) => {
      const cat = a.categoryName.localeCompare(b.categoryName);
      if (cat !== 0) return cat;
      return a.productName.localeCompare(b.productName);
    });
  }, [productsMeta]);

  // Recherche : filtre les produits par nom / ref / nom couleur commandée
  const filteredProducts = useMemo(() => {
    if (!query.trim()) return productsList;
    const q = query.trim().toLowerCase();
    return productsList.filter((p) => {
      if (tp(p.productName).toLowerCase().includes(q)) return true;
      if (p.productReference.toLowerCase().includes(q)) return true;
      for (const v of p.variants) {
        if (tp(v.colorName).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [productsList, query, tp]);

  // Regrouper par catégorie
  const groupedByCategory = useMemo(() => {
    const g: Record<string, ProductMeta[]> = {};
    for (const p of filteredProducts) {
      const cat = p.categoryName;
      if (!g[cat]) g[cat] = [];
      g[cat].push(p);
    }
    return g;
  }, [filteredProducts]);
  const categoryCount = Object.keys(groupedByCategory).length;

  // Subtotal & counters — utilise le calcul serveur (promoInfoByItemId) si disponible
  const subtotal = allItems.reduce(
    (s, item) => s + resolveItemFinalPrice(item.id, item.variant.unitPrice, item.variant.product.discountPercent ?? null, promoInfoByItemId) * item.quantity,
    0,
  );
  const totalUnits = allItems.reduce((s, item) => {
    const units = item.variant.saleType === "PACK" && item.variant.packQuantity
      ? item.variant.packQuantity * item.quantity
      : item.quantity;
    return s + units;
  }, 0);
  const modelsCount = productsList.length;                                  // # produits uniques (« modèles »)
  const totalOrdered = allItems.reduce((s, item) => s + item.quantity, 0);  // somme des qty (packs ou unités)
  const minReached = minOrderHT <= 0 || subtotal >= minOrderHT;
  const minProgress = minOrderHT > 0 ? Math.min(100, (subtotal / minOrderHT) * 100) : 100;

  // Mise à jour quantité : pas d'overlay (debounce dans VariantRow suffit)
  // Toast d'erreur uniquement si problème, sinon silencieux.
  async function handleSetQty(variantId: string, qty: number) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const result = await setCartItemQuantity(variantId, qty);
          if (!result.success) {
            toast.error(t("updateErrorTitle"), result.error);
          } else if (result.capped) {
            toast.warning(t("stockCappedTitle"), t("stockCappedMessage", { qty: result.quantity }));
          }
          router.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : t("updateError");
          toast.error(t("updateErrorTitle"), message);
          router.refresh();
        } finally {
          resolve();
        }
      });
    });
  }

  async function handleRemoveProduct(productId: string) {
    const meta = productsMeta[productId];
    if (!meta) return;
    showLoading();
    startTransition(async () => {
      try {
        // Supprimer toutes les variantes commandées de ce produit
        for (const v of meta.variants) {
          const item = itemsByVariantId.get(v.variantId);
          if (item && item.quantity > 0) {
            await setCartItemQuantity(v.variantId, 0);
          }
        }
        // Supprimer aussi les multi-color packs
        const mcpItems = multiColorPackItemsByProduct.get(productId) ?? [];
        for (const item of mcpItems) {
          await setCartItemQuantity(item.variant.id, 0);
        }
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  }

  function handleClearCart() {
    showLoading();
    startTransition(async () => {
      try {
        await clearCart();
        setShowClearModal(false);
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  }

  function handleCheckout() {
    if (minOrderHT > 0 && subtotal < minOrderHT) {
      setShowMinError(true);
      return;
    }
    setShowMinError(false);
    router.push("/panier/commande");
  }

  // ── Panier vide ─────────────────────────────
  if (allItems.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <div className="bg-bg-primary border border-border rounded-2xl p-10 sm:p-14 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </div>
          <p className="font-heading text-xl font-bold text-text-primary mb-2">{t("empty")}</p>
          <p className="text-sm font-body text-text-secondary mb-8">{t("emptyDesc")}</p>
          <Link href="/produits" className="btn-primary justify-center w-full">{t("viewCatalogue")}</Link>
        </div>
      </div>
    );
  }

  return (
    <PromoInfoContext.Provider value={promoInfoByItemId}>
      <div className="max-w-[1440px] mx-auto">
        <div className="bg-bg-primary border border-border rounded-3xl shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-[124px_1fr_400px] min-h-[720px]">
          {/* Rail */}
          <aside className="hidden lg:block bg-bg-dark rounded-l-3xl">
            <RailStepper currentStep={0} />
          </aside>

          {/* Preview */}
          <section className="bg-bg-secondary/40 p-5 sm:p-8">
            <MobileProgress currentStep={0} />

            {/* En-tête */}
            <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted mb-1">{t("yourSelection")}</div>
                <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">{t("cartTitle")}</h1>
                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs font-body">
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-heading font-bold text-text-primary tabular-nums text-sm">{modelsCount}</span>
                    <span className="text-text-muted">{modelsCount > 1 ? t("modelsPlural") : t("modelsSingular")}</span>
                  </span>
                  <span className="text-text-muted/40" aria-hidden="true">·</span>
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-heading font-bold text-text-primary tabular-nums text-sm">{totalOrdered}</span>
                    <span className="text-text-muted">{totalOrdered > 1 ? t("orderedPlural") : t("orderedSingular")}</span>
                  </span>
                  <span className="text-text-muted/40" aria-hidden="true">·</span>
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-heading font-bold text-text-primary tabular-nums text-sm">{categoryCount}</span>
                    <span className="text-text-muted">{categoryCount > 1 ? t("categories_plural") : t("categories")}</span>
                  </span>
                  {totalUnits !== totalOrdered && (
                    <>
                      <span className="text-text-muted/40" aria-hidden="true">·</span>
                      <span className="text-text-muted italic">{totalUnits} {t("units_plural")} {t("totalUnits")}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/produits" className="btn-secondary text-xs">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                  </svg>
                  <span className="hidden sm:inline">{t("continueShopping")}</span>
                </Link>
                <button type="button" onClick={() => setShowClearModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-body text-text-muted hover:text-error transition-colors px-3 py-2 rounded-lg hover:bg-error/5 border border-transparent hover:border-error/20">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  <span className="hidden sm:inline">{t("clearCart")}</span>
                </button>
              </div>
            </div>

            {/* Recherche */}
            <div className="bg-bg-primary border border-border rounded-xl p-2.5 mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-text-muted shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="flex-1 bg-transparent border-0 focus:outline-none text-sm text-text-primary placeholder:text-text-muted"
                aria-label={t("searchPlaceholder")}
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="text-text-muted hover:text-text-primary text-lg leading-none px-2" aria-label={t("clearSearch")}>×</button>
              )}
            </div>

            {/* Liste produits groupée par catégorie */}
            {filteredProducts.length === 0 ? (
              <div className="bg-bg-primary border border-border rounded-2xl p-10 text-center">
                <p className="text-sm text-text-muted">{t("noSearchResult")}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedByCategory).map(([category, prods]) => (
                  <div key={category} className="space-y-3">
                    <div className="flex items-baseline justify-between px-1">
                      <span className="text-[11px] uppercase tracking-widest text-text-primary font-heading font-semibold">
                        {category}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {prods.length} {prods.length > 1 ? t("modelsPlural") : t("modelsSingular")}
                      </span>
                    </div>
                    {prods.map((meta) => (
                      <ProductGroupCard
                        key={meta.productId}
                        meta={meta}
                        itemsByVariantId={itemsByVariantId}
                        multiColorPackItems={multiColorPackItemsByProduct.get(meta.productId) ?? []}
                        onSetQty={handleSetQty}
                        onZoom={handleZoom}
                        onRemoveProduct={handleRemoveProduct}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Récap mobile */}
            <div className="lg:hidden mt-5 mb-24 bg-bg-primary border border-border rounded-2xl">
              <SummaryPanel
                subtotal={subtotal}
                minOrderHT={minOrderHT}
                minReached={minReached}
                minProgress={minProgress}
                stripeReady={stripeReady}
                showMinError={showMinError}
                onCheckout={handleCheckout}
                isPending={isPending}
                compact
              />
            </div>
          </section>

          {/* Récap desktop */}
          <aside className="hidden lg:block bg-bg-primary border-l border-border rounded-r-3xl">
            <SummaryPanel
              subtotal={subtotal}
              minOrderHT={minOrderHT}
              minReached={minReached}
              minProgress={minProgress}
              stripeReady={stripeReady}
              showMinError={showMinError}
              onCheckout={handleCheckout}
              isPending={isPending}
            />
          </aside>
        </div>
      </div>

      {/* Bottom bar mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-primary/95 backdrop-blur border-t border-border px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-text-muted">{t("estimatedTotal")}</div>
          <div className="font-heading text-lg font-bold text-text-primary leading-none">{subtotal.toFixed(2)} €</div>
        </div>
        <button type="button" disabled={!stripeReady || isPending} onClick={handleCheckout} className="btn-primary flex-1 justify-center h-11 text-sm disabled:opacity-50">
          {t("checkout")} →
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox image={lightbox.image} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      {/* Modal confirmation vider panier */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onMouseDown={backdropClearModal.onMouseDown} onMouseUp={backdropClearModal.onMouseUp} />
          <div className="relative bg-bg-primary rounded-2xl shadow-xl p-7 max-w-sm w-full border border-border">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </div>
              <div>
                <p className="font-heading font-semibold text-text-primary text-base mb-1">{t("clearConfirmTitle")}</p>
                <p className="text-sm font-body text-text-secondary">{t("clearConfirmDesc")}</p>
              </div>
              <div className="flex gap-3 w-full mt-1">
                <button type="button" onClick={() => setShowClearModal(false)} disabled={isPending} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-body text-text-secondary hover:border-text-muted transition-all disabled:opacity-50">
                  {t("cancel")}
                </button>
                <button type="button" onClick={handleClearCart} disabled={isPending} className="flex-1 py-2.5 bg-error hover:bg-error/90 rounded-lg text-sm font-body font-medium text-text-inverse transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {isPending ? (<span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />) : t("clear")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PromoInfoContext.Provider>
  );
}
