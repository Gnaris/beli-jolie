"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { removeFromCart, updateCartItem, clearCart } from "@/app/actions/client/cart";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

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
  color: { name: string; hex: string | null } | null;
  packLines?: { colorName: string; colorHex: string | null; sizes: { name: string; quantity: number }[] }[];
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
  minOrderHT: number;
  stripeReady?: boolean;
}

// ─────────────────────────────────────────────
// Calcul prix
// ─────────────────────────────────────────────

function computeUnitPrice(v: VariantData): number {
  const price = Number(v.unitPrice);
  const base = v.saleType === "UNIT" ? price : price * (v.packQuantity ?? 1);
  const discountPercent = v.product.discountPercent != null ? Number(v.product.discountPercent) : null;
  if (!discountPercent || discountPercent <= 0) return base;
  return Math.max(0, base * (1 - discountPercent / 100));
}

// ─────────────────────────────────────────────
// Stepper
// ─────────────────────────────────────────────

function CheckoutStepper({ currentStep }: { currentStep: number }) {
  const steps = [
    { label: "Panier", href: "/panier" },
    { label: "Commande", href: "/panier/commande" },
    { label: "Confirmation", href: null },
  ];

  return (
    <nav className="flex items-center justify-center gap-0 mb-8 md:mb-10">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <div key={step.label} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-14 h-px mx-1 sm:mx-2 transition-colors ${isDone ? "bg-bg-dark" : "bg-border"}`} />
            )}
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-body transition-all shrink-0 ${
                isActive
                  ? "bg-bg-dark text-white"
                  : isDone
                    ? "bg-bg-dark text-white"
                    : "bg-bg-tertiary text-text-muted"
              }`}>
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {step.href && (isDone || isActive) ? (
                <Link href={step.href} className={`text-sm font-body font-medium transition-colors hidden sm:block ${
                  isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}>
                  {step.label}
                </Link>
              ) : (
                <span className={`text-sm font-body font-medium hidden sm:block ${
                  isActive ? "text-text-primary" : "text-text-muted"
                }`}>
                  {step.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────
// Composant ligne produit
// ─────────────────────────────────────────────

function CartRow({
  item, onRemove, onQtyChange, isPending,
}: {
  item: CartItemData;
  onRemove: (id: string) => void;
  onQtyChange: (id: string, qty: number) => void;
  isPending: boolean;
}) {
  const t = useTranslations("cart");
  const { tp } = useProductTranslation();
  const v = item.variant;
  const product = v.product;
  const image = item.variantImages[0]?.path ?? null;
  const unitPrice = computeUnitPrice(v);
  const lineTotal = unitPrice * item.quantity;
  const hasDiscount = v.product.discountPercent != null && Number(v.product.discountPercent) > 0;
  const packUnits = v.saleType === "PACK" ? (v.packQuantity ?? 1) * item.quantity : item.quantity;

  return (
    <div className="group flex gap-4 py-5 border-b border-border-light last:border-0 transition-colors">
      {/* Image */}
      <Link href={`/produits/${product.id}`} className="shrink-0">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-bg-secondary border border-border-light group-hover:border-border transition-colors">
          {image ? (
            <Image src={image} alt={tp(product.name)} width={96} height={96} sizes="96px" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Infos produit */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/produits/${product.id}`}
              className="text-sm font-body font-semibold text-text-primary hover:text-text-secondary transition-colors line-clamp-2">
              {tp(product.name)}
            </Link>
            <p className="text-xs font-mono text-text-muted mt-0.5">{product.reference}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-heading font-bold text-text-primary text-base">{lineTotal.toFixed(2)} €</p>
            <p className="text-xs text-text-muted font-body">
              {unitPrice.toFixed(2)} € {v.saleType === "UNIT" ? t("perUnit") : t("perPack")}
            </p>
            {hasDiscount && (
              <span className="inline-block text-[10px] font-body font-semibold text-white bg-error px-1.5 py-0.5 rounded mt-0.5">
                -{Number(v.product.discountPercent)}%
              </span>
            )}
          </div>
        </div>

        {/* Badges variante */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {v.packLines && v.packLines.length > 0 ? (
            v.packLines.map((line, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 text-xs bg-bg-secondary text-text-secondary px-2.5 py-1 rounded-lg border border-border-light font-body">
                {line.colorHex && (
                  <span className="w-3 h-3 rounded-full border border-border-light shrink-0" style={{ backgroundColor: line.colorHex }} />
                )}
                <span>{tp(line.colorName)}</span>
                <span className="text-text-muted">— {line.sizes.map((s) => `${s.name}×${s.quantity}`).join(", ")}</span>
              </span>
            ))
          ) : (
            v.color && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-bg-secondary text-text-secondary px-2.5 py-1 rounded-lg border border-border-light font-body">
                {v.color.hex && (
                  <span className="w-3 h-3 rounded-full border border-border-light shrink-0" style={{ backgroundColor: v.color.hex }} />
                )}
                {tp(v.color.name)}
              </span>
            )
          )}
          {v.saleType === "PACK" && (
            <span className="text-xs bg-bg-secondary text-text-primary px-2.5 py-1 rounded-lg border border-border-light font-body font-medium">
              {t("packLabel")} ×{v.packQuantity}
            </span>
          )}
          {(!v.packLines || v.packLines.length === 0) && v.sizes?.length > 0 && (
            <span className="text-xs bg-bg-secondary text-text-muted px-2.5 py-1 rounded-lg border border-border-light font-body">
              {v.sizes.map((s) => `${s.name} ×${s.quantity}`).join(", ")}
            </span>
          )}
        </div>
        {v.saleType === "PACK" && (
          <p className="text-xs text-text-muted font-body mt-1.5">{packUnits} {t("totalUnits")}</p>
        )}

        {/* Quantité + Supprimer */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-0.5 bg-bg-secondary rounded-xl border border-border-light overflow-hidden">
            <button
              type="button"
              disabled={isPending}
              onClick={() => onQtyChange(item.id, item.quantity - 1)}
              className="w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors text-base font-medium disabled:opacity-30"
            >−</button>
            <span className="w-10 h-9 flex items-center justify-center text-sm font-semibold text-text-primary font-body tabular-nums">
              {item.quantity}
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onQtyChange(item.id, item.quantity + 1)}
              className="w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors text-base font-medium disabled:opacity-30"
            >+</button>
          </div>

          <button
            type="button"
            disabled={isPending}
            onClick={() => onRemove(item.id)}
            className="text-xs text-text-muted hover:text-error transition-colors flex items-center gap-1.5 disabled:opacity-30 px-2 py-1 rounded-lg hover:bg-error/5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            {t("remove")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────

export default function CartPageClient({ cart, minOrderHT, stripeReady = true }: Props) {
  const t = useTranslations("cart");
  const { tc: translateCat } = useProductTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [showClearModal, setShowClearModal] = useState(false);
  const [showMinError, setShowMinError] = useState(false);
  const backdropClearModal = useBackdropClose(() => setShowClearModal(false));

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

  // Grouper par catégorie
  const grouped: Record<string, CartItemData[]> = {};
  (cart?.items ?? []).forEach((item) => {
    const cat = item.variant.product.category.name;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  const allItems = cart?.items ?? [];
  const subtotal = allItems.reduce((s, item) => s + computeUnitPrice(item.variant) * item.quantity, 0);
  const totalUnits = allItems.reduce((s, item) => {
    const units = item.variant.saleType === "PACK"
      ? (item.variant.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + units;
  }, 0);
  const minReached = minOrderHT <= 0 || subtotal >= minOrderHT;
  const minProgress = minOrderHT > 0 ? Math.min(100, (subtotal / minOrderHT) * 100) : 100;

  function handleRemove(cartItemId: string) {
    showLoading();
    startTransition(async () => {
      try {
        await removeFromCart(cartItemId);
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  }

  function handleQtyChange(cartItemId: string, qty: number) {
    if (qty < 1) {
      handleRemove(cartItemId);
      return;
    }
    showLoading();
    startTransition(async () => {
      try {
        await updateCartItem(cartItemId, qty);
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  }

  // ── Panier vide ─────────────────────────────
  if (allItems.length === 0) {
    return (
      <div className="container-site py-10 md:py-14">
        <CheckoutStepper currentStep={0} />
        <div className="max-w-md mx-auto text-center">
          <div className="bg-bg-primary border border-border rounded-2xl p-10 sm:p-14 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </div>
            <p className="font-heading text-xl font-bold text-text-primary mb-2">{t("empty")}</p>
            <p className="text-sm font-body text-text-secondary mb-8">{t("emptyDesc")}</p>
            <Link href="/produits" className="btn-primary justify-center w-full">
              {t("viewCatalogue")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-site py-10 md:py-14">
      <CheckoutStepper currentStep={0} />

      {/* En-tête */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
            {t("title")}
          </h1>
          <p className="text-sm font-body text-text-secondary mt-1">
            {allItems.length} {allItems.length > 1 ? t("references_plural") : t("references")} · {totalUnits} {totalUnits > 1 ? t("units_plural") : t("units")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowClearModal(true)}
          className="flex items-center gap-1.5 text-xs font-body text-text-muted hover:text-error transition-colors px-3 py-1.5 rounded-lg hover:bg-error/5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          {t("clearCart")}
        </button>
      </div>

      {/* ── Modal confirmation vider panier ── */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onMouseDown={backdropClearModal.onMouseDown} onMouseUp={backdropClearModal.onMouseUp} />
          <div className="relative bg-bg-primary rounded-2xl shadow-xl p-7 max-w-sm w-full border border-border">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </div>
              <div>
                <p className="font-heading font-semibold text-text-primary text-base mb-1">
                  Vider le panier ?
                </p>
                <p className="text-sm font-body text-text-secondary">
                  Tous les articles seront supprimés. Cette action est irréversible.
                </p>
              </div>
              <div className="flex gap-3 w-full mt-1">
                <button type="button" onClick={() => setShowClearModal(false)} disabled={isPending}
                  className="flex-1 py-2.5 border border-border rounded-lg text-sm font-body text-text-secondary hover:border-text-muted transition-all disabled:opacity-50">
                  Annuler
                </button>
                <button type="button" onClick={handleClearCart} disabled={isPending}
                  className="flex-1 py-2.5 bg-error hover:bg-error/90 rounded-lg text-sm font-body font-medium text-text-inverse transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {isPending ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : "Vider"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">

        {/* ── Liste articles ─────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-border-light bg-bg-secondary/60 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-text-muted" />
                <h2 className="font-heading text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {translateCat(category)}
                </h2>
                <span className="text-xs text-text-muted font-body ml-auto">{items.length} article{items.length > 1 ? "s" : ""}</span>
              </div>
              <div className="px-5">
                {items.map((item) => (
                  <CartRow key={item.id} item={item} onRemove={handleRemove} onQtyChange={handleQtyChange} isPending={isPending} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Récapitulatif ───────────────────────── */}
        <div className="lg:sticky lg:top-24">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
            {/* En-tête */}
            <div className="px-5 py-4 border-b border-border-light bg-bg-secondary/50">
              <h3 className="font-heading text-sm font-semibold text-text-primary">Récapitulatif</h3>
            </div>

            <div className="p-5 space-y-4">
              {/* Lignes de prix */}
              <div className="space-y-2.5 text-sm font-body">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Sous-total HT</span>
                  <span className="font-semibold text-text-primary tabular-nums">{subtotal.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>TVA</span>
                  <span className="text-xs italic">calculée à l&apos;étape suivante</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Livraison</span>
                  <span className="text-xs italic">calculée à l&apos;étape suivante</span>
                </div>
              </div>

              <div className="border-t border-border-light pt-3 flex justify-between items-baseline">
                <span className="text-sm font-body font-semibold text-text-primary">Total HT estimé</span>
                <span className="font-heading font-bold text-xl text-text-primary tabular-nums">{subtotal.toFixed(2)} €</span>
              </div>

              {/* Minimum d'achat */}
              {minOrderHT > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs font-body">
                    <span className="text-text-muted">Minimum d&apos;achat HT</span>
                    <span className={`font-semibold tabular-nums ${minReached ? "text-success" : "text-text-secondary"}`}>
                      {subtotal.toFixed(2)} / {minOrderHT.toFixed(2)} €
                    </span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        minReached
                          ? "bg-success"
                          : "bg-warning"
                      }`}
                      style={{ width: `${minProgress.toFixed(1)}%` }}
                    />
                  </div>
                  {!minReached && (
                    <p className="text-xs font-body text-warning flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      Encore {(minOrderHT - subtotal).toFixed(2)} € pour atteindre le minimum
                    </p>
                  )}
                </div>
              )}

              {/* Erreur minimum au clic */}
              {showMinError && (
                <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-3 py-2.5 text-xs font-body text-warning">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span>Montant minimum de <strong>{minOrderHT.toFixed(2)} € HT</strong> non atteint.</span>
                </div>
              )}

              {!stripeReady && (
                <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-xl px-3 py-2.5 text-xs font-body text-error">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span>Aucun moyen de paiement n&apos;est disponible. Contactez le personnel.</span>
                </div>
              )}

              {/* CTA Commander */}
              <button
                type="button"
                disabled={!stripeReady}
                onClick={() => {
                  if (minOrderHT > 0 && subtotal < minOrderHT) {
                    setShowMinError(true);
                    return;
                  }
                  setShowMinError(false);
                  router.push("/panier/commande");
                }}
                className="btn-primary w-full justify-center h-12 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Passer la commande
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>

              <Link href="/produits"
                className="text-xs font-body text-text-muted hover:text-text-primary transition-colors flex items-center justify-center gap-1.5 py-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Continuer mes achats
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
