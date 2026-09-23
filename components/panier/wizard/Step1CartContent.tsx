"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { buildProductHandle } from "@/lib/product-url";
import { setCartItemQuantity } from "@/app/actions/client/cart";
import type { CartValidationError } from "@/lib/cart-validation";
import type {
  WizardCart,
  WizardProductsMeta,
  WizardPromoInfo,
} from "./types";

/**
 * Étape 1 — Panier. Affiche pour chaque produit du panier la grille COMPLÈTE
 * de ses variantes (toutes les couleurs disponibles). Les lignes commandées
 * (qty > 0) sont surlignées vert doux + bande verte à gauche. L'utilisatrice
 * peut cliquer sur `+` d'une variante à 0 pour l'ajouter à la volée.
 */
export default function Step1CartContent({
  cart,
  productsMeta,
  onCartMutated,
  validationErrors = [],
  onClearErrors,
  promoInfoByItemId = {},
  clientDiscount = null,
  minOrderHT = 0,
  subtotalHT = 0,
  hasMergeCandidates = false,
}: {
  cart: WizardCart;
  productsMeta: WizardProductsMeta;
  onCartMutated: () => void;
  /** Erreurs de disponibilité remontées par /api/cart/validate (produit offline / rupture). */
  validationErrors?: CartValidationError[];
  /** Callback pour vider les erreurs (appelé après action corrective sur la ligne). */
  onClearErrors?: () => void;
  /** Prix résolus côté serveur (promos AUTO + code + remise manuelle). */
  promoInfoByItemId?: Record<string, WizardPromoInfo>;
  /** Remise commerciale du client (cumulée en cascade sur le prix serveur). */
  clientDiscount?: { type: "PERCENT" | "AMOUNT"; value: number } | null;
  /** Seuil HT applicable au client (0 = pas de minimum). */
  minOrderHT?: number;
  /** Sous-total HT courant du panier (après remises). */
  subtotalHT?: number;
  /** Le client a-t-il au moins une commande PENDING à laquelle il peut ajouter ce panier ? */
  hasMergeCandidates?: boolean;
}) {
  const t = useTranslations("cart");

  const modelsCount = Object.keys(productsMeta).length;
  const totalOrdered = cart.items.reduce((s, i) => s + i.quantity, 0);
  void modelsCount; void totalOrdered;

  // Lookup rapide des erreurs par variantId
  const errorsByVariantId = useMemo(() => {
    const m = new Map<string, CartValidationError>();
    for (const e of validationErrors) m.set(e.variantId, e);
    return m;
  }, [validationErrors]);
  const hasErrors = validationErrors.length > 0;

  // Lightbox pour zoomer sur une image (produit ou variante). Portalé sur <body>
  // via createPortal pour sortir des contextes d'empilement des cartes.
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);
  const [zoomedAlt, setZoomedAlt] = useState<string>("");

  const openZoom = (src: string, alt: string) => {
    setZoomedSrc(src);
    setZoomedAlt(alt);
  };
  const closeZoom = () => setZoomedSrc(null);

  useEffect(() => {
    if (!zoomedSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedSrc]);

  // Bandeau minimum d'achat à l'étape 1 :
  //  - sous minimum + fusion possible → info orange, la cliente pourra
  //    fusionner à l'étape 2 (bouton Continuer actif).
  //  - sous minimum + AUCUNE commande fusionnable → alerte rouge, la cliente
  //    est bloquée ici (bouton Continuer grisé côté SummaryPanel).
  const belowMin = minOrderHT > 0 && subtotalHT < minOrderHT;
  const missing = Math.max(0, minOrderHT - subtotalHT);

  return (
    <div className="space-y-5">
      {/* Bandeau minimum d'achat */}
      {belowMin && (
        <div
          className={`rounded-2xl border p-4 md:p-5 flex items-start gap-3 ${
            hasMergeCandidates
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-white border border-current/20 flex items-center justify-center shrink-0">
            !
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold">
              Minimum de commande : {minOrderHT.toFixed(2)} € HT
            </p>
            <p className="opacity-90 mt-0.5">
              Il vous manque <strong>{missing.toFixed(2)} € HT</strong>.{" "}
              {hasMergeCandidates
                ? "Vous pouvez soit ajouter des articles, soit passer à l'étape suivante pour ajouter ce panier à une commande en cours."
                : "Ajoutez des articles pour continuer."}
            </p>
          </div>
        </div>
      )}

      {/* Bandeau d'erreurs global si le passage au paiement a été refusé */}
      {hasErrors && (
        <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 p-4 md:p-5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-white border border-red-200 flex items-center justify-center shrink-0">
            !
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold">{t("validationErrorTitle")}</p>
            <p className="text-red-700 mt-0.5">{t("validationErrorDesc")}</p>
          </div>
        </div>
      )}

      {/* Grille par produit */}
      <div className="space-y-5">
        {Object.values(productsMeta).map((meta) => (
          <ProductCard
            key={meta.productId}
            meta={meta}
            cart={cart}
            onMutated={() => {
              onCartMutated();
              onClearErrors?.();
            }}
            errorsByVariantId={errorsByVariantId}
            promoInfoByItemId={promoInfoByItemId}
            clientDiscount={clientDiscount}
            onZoomImage={openZoom}
          />
        ))}
      </div>

      {/* Lightbox — zoom plein écran, click backdrop ou Échap ferme */}
      {zoomedSrc && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/90 sm:bg-black/80 flex items-center justify-center p-0 sm:p-4 touch-manipulation"
          onClick={closeZoom}
          role="dialog"
          aria-modal="true"
          aria-label={zoomedAlt || t("thColor")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedSrc}
            alt={zoomedAlt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[100dvh] max-w-[100vw] sm:max-h-[90vh] sm:max-w-[90vw] object-contain sm:shadow-2xl sm:rounded-xl touch-pinch-zoom"
          />
          <button
            type="button"
            onClick={closeZoom}
            className="absolute top-4 right-4 w-11 h-11 sm:w-9 sm:h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm transition-transform hover:scale-110"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Sub-composant : carte produit (header + grille variantes)
   ────────────────────────────────────────────── */
function ProductCard({
  meta,
  cart,
  onMutated,
  errorsByVariantId,
  promoInfoByItemId,
  clientDiscount,
  onZoomImage,
}: {
  meta: WizardProductsMeta[string];
  cart: WizardCart;
  onMutated: () => void;
  errorsByVariantId: Map<string, CartValidationError>;
  promoInfoByItemId: Record<string, WizardPromoInfo>;
  clientDiscount: { type: "PERCENT" | "AMOUNT"; value: number } | null;
  onZoomImage: (src: string, alt: string) => void;
}) {
  const t = useTranslations("cart");
  const { tp, tc: translateCat } = useProductTranslation();

  // Items du panier associés à ce produit
  const itemsByVariantId = useMemo(() => {
    const m = new Map<string, { id: string; quantity: number }>();
    for (const item of cart.items) {
      if (item.variant.productId === meta.productId) {
        m.set(item.variant.id, { id: item.id, quantity: item.quantity });
      }
    }
    return m;
  }, [cart.items, meta.productId]);

  // Total pour ce produit (variantes commandées uniquement)
  const productSubtotal = useMemo(() => {
    let total = 0;
    for (const v of meta.variants) {
      const item = itemsByVariantId.get(v.variantId);
      if (!item || item.quantity <= 0) continue;
      const price = computeUnitPrice(v.unitPrice, meta.discountPercent);
      total += price * item.quantity;
    }
    return total;
  }, [meta.variants, meta.discountPercent, itemsByVariantId]);

  const hasDiscount = meta.discountPercent != null && meta.discountPercent > 0;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header produit — thumb + nom sur ligne 1, sous-total en ligne 2 (mobile) pour ne pas serrer le bord droit */}
      <div className="p-4 md:p-5 bg-slate-50 border-b border-slate-100">
        <div className="flex gap-3 md:gap-4 min-w-0">
          <ProductThumb
            path={meta.mainImagePath}
            alt={tp(meta.productName)}
            onZoom={meta.mainImagePath ? () => onZoomImage(meta.mainImagePath!, tp(meta.productName)) : undefined}
          />
          <div className="flex-1 min-w-0">
            <Link
              href={`/produits/${buildProductHandle(meta.productName, meta.productReference)}`}
              className="block font-heading font-semibold text-slate-900 text-sm md:text-base truncate hover:underline"
            >
              {tp(meta.productName)}
            </Link>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              {meta.productReference} · {translateCat(meta.categoryName)}
              {hasDiscount && (
                <>
                  {" · "}
                  <span className="text-emerald-700 font-semibold">
                    −{meta.discountPercent}%
                  </span>
                </>
              )}
            </div>
            {/* Sous-total inline sur ≥ md, en ligne dédiée en mobile */}
            <div className="hidden md:flex items-center justify-end mt-2 gap-2">
              <span className="text-xs text-slate-500">{t("productSubtotal")}</span>
              <span className="font-semibold text-slate-900 tabular-nums text-sm whitespace-nowrap">
                {productSubtotal.toFixed(2)} €
              </span>
            </div>
          </div>
        </div>
        {/* Sous-total mobile — bande dédiée, plus lisible et centrée */}
        <div className="md:hidden mt-3 flex items-center justify-between text-xs">
          <span className="uppercase tracking-wide text-slate-400 font-semibold">{t("productSubtotal")}</span>
          <span className="font-semibold text-slate-900 tabular-nums text-sm whitespace-nowrap">
            {productSubtotal.toFixed(2)} €
          </span>
        </div>
      </div>

      {/* Grille variantes desktop */}
      <div className="hidden md:block">
        <div className="grid grid-cols-[2fr_0.9fr_0.9fr_1.1fr_0.9fr_44px] gap-3 items-center px-5 py-2.5 text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
          <div>{t("thColor")}</div>
          <div className="text-center">{t("thPrice")}</div>
          <div className="text-center">{t("thStock")}</div>
          <div className="text-center">{t("thQuantity")}</div>
          <div className="text-right">{t("thSubtotal")}</div>
          <div className="text-center">{t("thAction")}</div>
        </div>
        <div>
          {meta.variants.map((v) => (
            <VariantRow
              key={v.variantId}
              variant={v}
              discountPercent={meta.discountPercent}
              currentQty={itemsByVariantId.get(v.variantId)?.quantity ?? 0}
              cartItemId={itemsByVariantId.get(v.variantId)?.id ?? null}
              promoInfoByItemId={promoInfoByItemId}
              clientDiscount={clientDiscount}
              onMutated={onMutated}
              layout="desktop"
              validationError={errorsByVariantId.get(v.variantId) ?? null}
              onZoomImage={onZoomImage}
            />
          ))}
        </div>
      </div>

      {/* Grille variantes mobile — 1 carte par variante */}
      <div className="md:hidden divide-y divide-slate-100">
        {meta.variants.map((v) => (
          <VariantRow
            key={v.variantId}
            variant={v}
            discountPercent={meta.discountPercent}
            currentQty={itemsByVariantId.get(v.variantId)?.quantity ?? 0}
            cartItemId={itemsByVariantId.get(v.variantId)?.id ?? null}
            promoInfoByItemId={promoInfoByItemId}
            clientDiscount={clientDiscount}
            onMutated={onMutated}
            layout="mobile"
            validationError={errorsByVariantId.get(v.variantId) ?? null}
            onZoomImage={onZoomImage}
          />
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   Ligne de variante (une couleur × une déclinaison)
   ────────────────────────────────────────────── */
function VariantRow({
  variant,
  discountPercent,
  currentQty,
  cartItemId,
  promoInfoByItemId,
  clientDiscount,
  onMutated,
  layout,
  validationError = null,
  onZoomImage,
}: {
  variant: WizardProductsMeta[string]["variants"][number];
  discountPercent: number | null;
  currentQty: number;
  cartItemId: string | null;
  promoInfoByItemId: Record<string, WizardPromoInfo>;
  clientDiscount: { type: "PERCENT" | "AMOUNT"; value: number } | null;
  onMutated: () => void;
  layout: "desktop" | "mobile";
  validationError?: CartValidationError | null;
  onZoomImage: (src: string, alt: string) => void;
}) {
  const t = useTranslations("cart");
  const { tp } = useProductTranslation();

  const [qtyDraft, setQtyDraft] = useState(String(currentQty));
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) setQtyDraft(String(currentQty));
  }, [currentQty]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const effectiveStock =
    variant.saleType === "PACK" && variant.packQuantity
      ? Math.floor(variant.stock / variant.packQuantity)
      : variant.stock;
  const isOutOfStock = effectiveStock <= 0;
  const displayQty = parseInt(qtyDraft, 10) || 0;
  const isCommanded = displayQty > 0;
  // Prix serveur produit final (cascade remise fiche + promo AUTO + code).
  // La remise commerciale client s'applique une seule fois sur le total panier
  // (voir SummaryPanel/CheckoutClient), pas ici.
  const serverFinalPrice = cartItemId ? promoInfoByItemId[cartItemId]?.finalUnitPrice ?? null : null;
  const priceAfterPromos = serverFinalPrice ?? computeUnitPrice(variant.unitPrice, discountPercent);
  const unitPrice = priceAfterPromos;
  const lineTotal = unitPrice * displayQty;
  const hasAnyReduction = priceAfterPromos < variant.unitPrice - 0.005;

  function commitToServer(nextQty: number) {
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await setCartItemQuantity(variant.variantId, nextQty);
      dirtyRef.current = false;
      onMutated();
    }, 400);
  }

  function bump(delta: 1 | -1) {
    const current = parseInt(qtyDraft, 10) || 0;
    let next = current + delta;
    if (next < 0) next = 0;
    if (next > effectiveStock) next = effectiveStock;
    if (next === current) return;
    setQtyDraft(String(next));
    commitToServer(next);
  }

  function commitOnBlur() {
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
    commitToServer(capped);
  }

  const stockLabel =
    isOutOfStock
      ? t("outOfStock")
      : effectiveStock < 5
        ? t("lowStockShort", { count: effectiveStock })
        : t("inStock");
  const stockColor =
    isOutOfStock ? "text-slate-400" : effectiveStock < 5 ? "text-amber-700" : "text-emerald-700";

  // Erreur visible SEULEMENT si la variante est encore commandée (une fois
  // remise à 0 via la corbeille, la ligne redevient neutre).
  const showError = !!validationError && isCommanded;
  const rowBg = showError
    ? "bg-red-50"
    : isCommanded
      ? "bg-emerald-50/60"
      : isOutOfStock
        ? "bg-white opacity-60"
        : "bg-white";
  const borderLeft = showError
    ? "border-l-4 border-l-red-500"
    : isCommanded
      ? "border-l-4 border-l-emerald-500"
      : "border-l-4 border-l-transparent";

  const removeButton = (
    <button
      type="button"
      onClick={() => {
        setQtyDraft("0");
        commitToServer(0);
      }}
      disabled={!isCommanded}
      className="w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center transition-colors"
      aria-label={t("removeVariantLabel")}
      title={t("removeVariantLabel")}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
        />
      </svg>
    </button>
  );

  // Prix ligne panier :
  //  • Prix catalogue par défaut.
  //  • Barré + rouge dès qu'une promotion active (/admin/promotions) OU
  //    une remise manuelle sur variante s'applique.
  //  • serverFinalPrice = prix calculé côté serveur (cascade remise variante ×
  //    meilleure promotion, tronqué), sans remise commerciale (elle reste
  //    exclusivement au récap panier).
  const displayPrice = serverFinalPrice ?? computeUnitPrice(variant.unitPrice, discountPercent);
  const hasReduction = displayPrice < variant.unitPrice - 0.005;
  // Pour un PACK, on affiche aussi le prix par unité (troncature au centime).
  // Si remise : perUnitRaw barré + perUnitFinal rouge, comme sur le total pack.
  const isPackWithQty = variant.saleType === "PACK" && !!variant.packQuantity && variant.packQuantity > 0;
  const perUnitFinal = isPackWithQty ? Math.floor((displayPrice / variant.packQuantity!) * 100) / 100 : null;
  const perUnitRaw = isPackWithQty ? Math.floor((variant.unitPrice / variant.packQuantity!) * 100) / 100 : null;
  const priceBlock = (
    <div className="text-center text-sm">
      {hasReduction ? (
        <>
          <span className="text-slate-400 line-through mr-1 text-xs">
            {variant.unitPrice.toFixed(2)} €
          </span>
          <span className="font-medium text-error">{displayPrice.toFixed(2)} €</span>
        </>
      ) : (
        <span className="font-medium text-slate-900">{variant.unitPrice.toFixed(2)} €</span>
      )}
      {perUnitFinal != null && perUnitRaw != null && (
        <div className="text-[10px] font-body mt-0.5">
          {hasReduction ? (
            <>
              <span className="text-slate-400 line-through mr-1">{perUnitRaw.toFixed(2)} €</span>
              <span className="text-error font-medium">{perUnitFinal.toFixed(2)} €</span>
              <span className="text-text-muted"> / u.</span>
            </>
          ) : (
            <span className="text-text-muted">{perUnitFinal.toFixed(2)} € / u.</span>
          )}
        </div>
      )}
    </div>
  );

  const qtyBlock = (
    <div className="flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => bump(-1)}
        disabled={displayQty <= 0}
        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
        aria-label={t("decrement")}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={qtyDraft}
        onChange={(e) => {
          dirtyRef.current = true;
          setQtyDraft(e.target.value.replace(/[^0-9]/g, ""));
        }}
        onBlur={commitOnBlur}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-11 h-7 text-center text-sm font-semibold tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
        aria-label={t("quantity")}
        disabled={isOutOfStock}
      />
      <button
        type="button"
        onClick={() => bump(1)}
        disabled={displayQty >= effectiveStock}
        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
        aria-label={t("increment")}
      >
        +
      </button>
    </div>
  );

  // Source à zoomer : priorité image variante > pattern couleur.
  const zoomSrc = variant.firstImagePath || variant.colorPatternImage || null;
  const openZoom = zoomSrc ? () => onZoomImage(zoomSrc, tp(variant.colorName)) : undefined;

  if (layout === "desktop") {
    return (
      <div
        className={`${rowBg} ${borderLeft} border-t border-slate-100 transition-colors`}
      >
        <div className="grid grid-cols-[2fr_0.9fr_0.9fr_1.1fr_0.9fr_44px] gap-3 items-center px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <ColorSwatch
              hex={variant.colorHex}
              pattern={variant.colorPatternImage}
              image={variant.firstImagePath}
              onZoom={openZoom}
            />
            <div className="min-w-0">
              <div className="font-medium text-sm text-slate-900 truncate">
                {tp(variant.colorName)}
                {variant.saleType === "PACK" && variant.packQuantity ? (
                  <span className="ml-2 text-xs font-semibold text-slate-500">
                    PACK ×{variant.packQuantity}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {priceBlock}
          <div className={`text-center text-xs font-medium ${stockColor}`}>{stockLabel}</div>
          {qtyBlock}
          <div className="text-right font-semibold text-sm tabular-nums">
            {isCommanded ? `${lineTotal.toFixed(2)} €` : <span className="text-slate-300">—</span>}
          </div>
          <div className="flex justify-center">{removeButton}</div>
        </div>
        {showError && (
          <div className="px-5 pb-3 -mt-1 text-xs text-red-700 font-medium">
            {validationError.message}
          </div>
        )}
      </div>
    );
  }

  // ── LAYOUT MOBILE ── Carte structurée en 3 blocs bien séparés :
  //   1. En-tête : image zoomable (56×56) + nom couleur + badge PACK
  //   2. Fiche infos : liste <dl> alignée label ↔ valeur (Prix · Stock · Sous-total)
  //   3. Actions : quantité centrée + corbeille à droite
  return (
    <div className={`px-4 py-4 ${rowBg} ${borderLeft} overflow-hidden`}>
      {/* En-tête — image cliquable (loupe) + nom couleur */}
      <div className="flex items-center gap-3 min-w-0">
        <ColorSwatch
          hex={variant.colorHex}
          pattern={variant.colorPatternImage}
          image={variant.firstImagePath}
          onZoom={openZoom}
          size="lg"
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-slate-900 truncate">
            {tp(variant.colorName)}
          </div>
          {variant.saleType === "PACK" && variant.packQuantity ? (
            <div className="mt-0.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
              PACK ×{variant.packQuantity}
            </div>
          ) : null}
        </div>
      </div>

      {/* Fiche infos — liste alignée */}
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{t("thPrice")}</dt>
          <dd className="tabular-nums text-right whitespace-nowrap">
            {hasReduction ? (
              <>
                <span className="text-slate-400 line-through mr-1">{variant.unitPrice.toFixed(2)} €</span>
                <span className="text-error font-medium">{unitPrice.toFixed(2)} €</span>
              </>
            ) : (
              <span className="text-slate-900 font-medium">{unitPrice.toFixed(2)} €</span>
            )}
          </dd>
        </div>
        {perUnitFinal != null && perUnitRaw != null && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Prix / u.</dt>
            <dd className="tabular-nums text-right whitespace-nowrap">
              {hasReduction ? (
                <>
                  <span className="text-slate-400 line-through mr-1">{perUnitRaw.toFixed(2)} €</span>
                  <span className="text-error font-medium">{perUnitFinal.toFixed(2)} €</span>
                </>
              ) : (
                <span className="text-text-muted">{perUnitFinal.toFixed(2)} €</span>
              )}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{t("thStock")}</dt>
          <dd className={`font-medium text-right whitespace-nowrap ${stockColor}`}>{stockLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t border-slate-100">
          <dt className="font-medium text-slate-700">{t("thSubtotal")}</dt>
          <dd className="tabular-nums text-right whitespace-nowrap font-semibold text-sm text-slate-900">
            {isCommanded ? `${lineTotal.toFixed(2)} €` : <span className="text-slate-300">—</span>}
          </dd>
        </div>
      </dl>

      {showError && (
        <div className="mt-2 text-xs text-red-700 font-medium">{validationError.message}</div>
      )}

      {/* Actions — qty centrée + supprimer aligné droite */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 flex justify-center">{qtyBlock}</div>
        <div className="shrink-0">{removeButton}</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Vignette produit (image ou placeholder) — cliquable si onZoom fourni
   ────────────────────────────────────────────── */
function ProductThumb({
  path,
  alt,
  onZoom,
}: {
  path: string | null;
  alt: string;
  onZoom?: () => void;
}) {
  if (!path) {
    return (
      <div className="w-16 h-20 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300 shrink-0">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
          />
        </svg>
      </div>
    );
  }
  if (onZoom) {
    return (
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Agrandir ${alt}`}
        className="relative w-16 h-20 shrink-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded-xl"
      >
        <span className="block w-full h-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
          <Image src={path} alt={alt} width={128} height={160} className="w-full h-full object-cover" />
        </span>
        {/* Loupe hors du rectangle clippé — bien visible sur le bord. */}
        <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-slate-900 text-white ring-2 ring-white flex items-center justify-center pointer-events-none shadow-sm">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10.5 7.5v6m-3-3h6" />
          </svg>
        </span>
      </button>
    );
  }
  return (
    <div className="relative w-16 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
      <Image src={path} alt={alt} width={128} height={160} className="w-full h-full object-cover" />
    </div>
  );
}

/* ──────────────────────────────────────────────
   Pastille couleur (patternImage prioritaire sur hex) — cliquable si onZoom
   fourni ET si le swatch a une image/pattern à agrandir. Taille "lg" = 56px
   (mobile card header) pour être facile à taper.
   ────────────────────────────────────────────── */
function ColorSwatch({
  hex,
  pattern,
  image,
  onZoom,
  size = "sm",
}: {
  hex: string | null;
  pattern: string | null;
  image: string | null;
  onZoom?: () => void;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "w-14 h-14" : "w-8 h-8";
  const zoomable = !!onZoom && !!(image || pattern);

  // Priorité : image de la variante > patternImage > hex.
  const inner = image ? (
    <Image src={image} alt="" width={112} height={112} className="w-full h-full object-cover" />
  ) : pattern ? (
    <span className="block w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${pattern})` }} />
  ) : (
    <span className="block w-full h-full" style={{ backgroundColor: hex ?? "#f1f5f9" }} />
  );

  if (zoomable) {
    return (
      <button
        type="button"
        onClick={onZoom}
        aria-label="Agrandir l'image"
        className={`relative shrink-0 rounded-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${dim}`}
      >
        {/* Cercle image : découpé, bordure. `overflow-hidden` ici seulement. */}
        <span className={`block w-full h-full rounded-full overflow-hidden border border-slate-200 bg-slate-100`}>
          {inner}
        </span>
        {/* Loupe hors du cercle → non clippée, posée sur le bord (ring blanc pour ressortir). */}
        <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-slate-900 text-white ring-2 ring-white flex items-center justify-center pointer-events-none shadow-sm">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10.5 7.5v6m-3-3h6" />
          </svg>
        </span>
      </button>
    );
  }
  return (
    <span className={`${dim} rounded-full overflow-hidden border border-slate-200 shrink-0 bg-slate-100 block`}>
      {inner}
    </span>
  );
}

/* ──────────────────────────────────────────────
   Helper prix — remise produit uniquement (les promotions applicables
   sont calculées côté SummaryPanel via promoInfoByItemId).
   ────────────────────────────────────────────── */
function computeUnitPrice(basePrice: number, discountPercent: number | null): number {
  if (!discountPercent || discountPercent <= 0) return basePrice;
  return Math.max(0, basePrice * (1 - discountPercent / 100));
}
