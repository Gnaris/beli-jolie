"use client";

import { useTranslations } from "next-intl";
import { useProductTranslation } from "@/hooks/useProductTranslation";
import type {
  WizardCart,
  WizardCarrier,
  WizardPromoInfo,
  DeliveryMode,
  WizardMergeCandidate,
} from "./types";

/**
 * Ligne de cascade affichée dans le récap (série de réductions, une par ligne).
 */
export interface SummaryCascadeLine {
  label: string;
  kind: "product" | "promo" | "client";
  percent?: number;
  amount: number;
  subtotalAfter: number;
}

/**
 * Récap de commande sticky (colonne droite) — 3 sections visibles :
 *   1. PANIER : Prix HT brut → cascade promos + remise commerciale → Prix HT après remises
 *   2. LIVRAISON (masquée sur l'étape 1) : cascade des promos + remise livraison
 *   3. TAXES + TOTAL TTC (masqués sur l'étape 1)
 */
export default function SummaryPanel({
  cart,
  promoInfoByItemId,
  currentStep,
  // Panier
  cartCascade,
  cartFallbackSubtotal,
  // Livraison
  shippingTrace,
  effectiveCarrierPrice,
  carrierBasePrice,
  shippingLabelOverride,
  // TVA
  tvaLabel,
  tvaOnCart,
  tvaOnShipping,
  totalTTC,
  deliveryMode,
  selectedCarrier,
  selectedMergeOrder,
  ctaLabel,
  ctaDisabled,
  onCta,
  backLabel,
  onBack,
  helperNote,
}: {
  cart: WizardCart;
  promoInfoByItemId: Record<string, WizardPromoInfo>;
  /** 1 = panier, 2 = livraison, 3 = paiement. */
  currentStep: 1 | 2 | 3;
  cartCascade: {
    subtotalBrutHT: number;
    subtotalHT: number;
    clientDiscountAmt: number;
    subtotalAfterDiscount: number;
    discountTrace: SummaryCascadeLine[];
  } | null;
  /** Sous-total calculé côté client si `cartCascade` est absent. */
  cartFallbackSubtotal: number;
  shippingTrace?: SummaryCascadeLine[];
  effectiveCarrierPrice: number;
  carrierBasePrice: number;
  /** Libellé à afficher à la place de "Livraison" (ex : « Retrait sur place »). */
  shippingLabelOverride?: string | null;
  tvaLabel: string;
  tvaOnCart: number;
  tvaOnShipping: number;
  totalTTC: number;
  deliveryMode: DeliveryMode;
  selectedCarrier: WizardCarrier | null;
  selectedMergeOrder: WizardMergeCandidate | null;
  ctaLabel: string;
  ctaDisabled?: boolean;
  onCta: () => void;
  backLabel?: string;
  onBack?: () => void;
  helperNote?: string | null;
}) {
  const t = useTranslations("cart");
  const tCheckout = useTranslations("checkout");
  const { tp } = useProductTranslation();

  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
  const modelsCount = cart.items.length;

  // Détermination du prix de vente HT à afficher (utilisé si cartCascade absent).
  const subtotalDisplay = cartCascade?.subtotalAfterDiscount ?? cartFallbackSubtotal;
  const brutHT = cartCascade?.subtotalBrutHT ?? cartFallbackSubtotal;

  const shippingLabel =
    shippingLabelOverride ??
    (deliveryMode === "pickup"
      ? tCheckout("modePickup")
      : deliveryMode === "private"
        ? tCheckout("modePrivate")
        : deliveryMode === "merge"
          ? selectedMergeOrder
            ? `${tCheckout("modeMerge")} · #${selectedMergeOrder.orderNumber}`
            : tCheckout("modeMerge")
          : selectedCarrier?.name ?? "—");

  const shippingIsFree =
    deliveryMode === "pickup" ||
    deliveryMode === "private" ||
    deliveryMode === "merge" ||
    (selectedCarrier != null && effectiveCarrierPrice === 0);

  return (
    <aside className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6 lg:sticky lg:top-24">
      <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
        {t("summaryEyebrow")}
      </div>
      <h3 className="font-heading text-lg font-semibold text-slate-900 mb-5">
        {t("summaryTitle")}
      </h3>

      {/* Détail articles pliable */}
      <details className="mb-4 group">
        <summary className="flex items-center justify-between text-sm text-slate-600 hover:text-slate-900 py-2 border-b border-slate-100 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span>
            {modelsCount} {modelsCount > 1 ? t("modelsPlural") : t("modelsSingular")} · {itemCount}{" "}
            {itemCount > 1 ? t("units_plural") : t("units")}
          </span>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            {t("summaryDetail")}
            <svg
              className="w-3.5 h-3.5 transition-transform group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </summary>
        <ul className="pt-3 space-y-2 text-sm max-h-64 overflow-auto pr-1">
          {cart.items.map((item) => {
            const promo = promoInfoByItemId[item.id];
            const unit = promo?.finalUnitPrice ?? item.variant.unitPrice;
            const total = unit * item.quantity;
            return (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="text-slate-600 truncate flex-1 min-w-0">
                  {tp(item.variant.product.name)} × {item.quantity}
                </span>
                <span className="whitespace-nowrap font-medium text-slate-900 tabular-nums">
                  {total.toFixed(2)} €
                </span>
              </li>
            );
          })}
        </ul>
      </details>

      {/* ─── SECTION PANIER — 2 blocs séparés : Promotion puis Remise commerciale ─── */}
      {(() => {
        // Découpage strict : lignes "product"/"promo" = promotions ; lignes "client" = remise commerciale.
        const promoLines = cartCascade?.discountTrace.filter((l) => l.kind !== "client") ?? [];
        const clientLines = cartCascade?.discountTrace.filter((l) => l.kind === "client") ?? [];
        // Total après promotion = brut − somme promo (troncature au centime, pas d'arrondi).
        const floor2 = (n: number) => Math.floor(n * 100) / 100;
        const totalPromosAmount = floor2(promoLines.reduce((s, l) => s + l.amount, 0));
        const subtotalAfterPromo = floor2(brutHT - totalPromosAmount);
        const totalClientAmount = floor2(clientLines.reduce((s, l) => s + l.amount, 0));
        const subtotalAfterClient = floor2(subtotalAfterPromo - totalClientAmount);

        return (
          <div className="space-y-4 text-sm">
            {/* ▸ BLOC 1 — Promotions */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Prix total HT</span>
                <span className="font-medium tabular-nums">{brutHT.toFixed(2)} €</span>
              </div>
              {promoLines.map((line, idx) => (
                <div key={`promo-${idx}`} className="flex justify-between text-emerald-700 pl-3">
                  <span className="truncate mr-2">
                    {line.label}
                    {line.percent != null && (
                      <span className="text-emerald-600/70"> −{line.percent}%</span>
                    )}
                  </span>
                  <span className="font-medium tabular-nums whitespace-nowrap">
                    −{line.amount.toFixed(2)} €
                  </span>
                </div>
              ))}
              {promoLines.length > 0 && (
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <span className="text-slate-700 font-medium">Total après promotion</span>
                  <span className="font-semibold tabular-nums">
                    {subtotalAfterPromo.toFixed(2)} €
                  </span>
                </div>
              )}
            </div>

            {/* ▸ BLOC 2 — Remise commerciale (séparé, base = total après promotion) */}
            {clientLines.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
                {clientLines.map((line, idx) => (
                  <div key={`client-${idx}`} className="flex justify-between text-emerald-700 pl-3">
                    <span className="truncate mr-2">
                      {line.label}
                      {line.percent != null && (
                        <span className="text-emerald-600/70"> −{line.percent}%</span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums whitespace-nowrap">
                      −{line.amount.toFixed(2)} €
                    </span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <span className="text-slate-700 font-medium">Total après remise commerciale</span>
                  <span className="font-semibold tabular-nums">
                    {subtotalAfterClient.toFixed(2)} €
                  </span>
                </div>
              </div>
            )}

            {/* Cas simple sans aucune remise : afficher juste le prix HT */}
            {promoLines.length === 0 && clientLines.length === 0 && (
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="text-slate-700 font-medium">Total HT</span>
                <span className="font-semibold tabular-nums">{brutHT.toFixed(2)} €</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── SECTION LIVRAISON — 2 blocs séparés (promotion, remise commerciale) ─── */}
      {currentStep >= 2 && (
        <>
          <div className="h-px bg-slate-200 my-4" />
          {(() => {
            const floor2 = (n: number) => Math.floor(n * 100) / 100;
            const shipPromoLines = shippingTrace?.filter((l) => l.kind !== "client") ?? [];
            const shipClientLines = shippingTrace?.filter((l) => l.kind === "client") ?? [];
            const shipPromoAmount = floor2(shipPromoLines.reduce((s, l) => s + l.amount, 0));
            const shipAfterPromo = floor2(carrierBasePrice - shipPromoAmount);
            const shipClientAmount = floor2(shipClientLines.reduce((s, l) => s + l.amount, 0));
            const shipAfterClient = floor2(shipAfterPromo - shipClientAmount);
            return (
              <div className="space-y-4 text-sm">
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Livraison
                </div>

                {/* ▸ BLOC 1 — Promotion livraison */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-600">
                      {t("summaryShipping")}{" "}
                      <span className="text-xs text-slate-400">({shippingLabel})</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {carrierBasePrice.toFixed(2)} €
                    </span>
                  </div>
                  {shipPromoLines.map((line, idx) => (
                    <div key={`ship-promo-${idx}`} className="flex justify-between text-emerald-700 pl-3">
                      <span className="truncate mr-2">
                        {line.label}
                        {line.percent != null && (
                          <span className="text-emerald-600/70"> −{line.percent}%</span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums whitespace-nowrap">
                        −{line.amount.toFixed(2)} €
                      </span>
                    </div>
                  ))}
                  {shipPromoLines.length > 0 && (
                    <div className="flex justify-between border-t border-slate-100 pt-2">
                      <span className="text-slate-700 font-medium">Livraison après promotion</span>
                      <span className="font-semibold tabular-nums">{shipAfterPromo.toFixed(2)} €</span>
                    </div>
                  )}
                </div>

                {/* ▸ BLOC 2 — Remise commerciale livraison */}
                {shipClientLines.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
                    {shipClientLines.map((line, idx) => (
                      <div key={`ship-client-${idx}`} className="flex justify-between text-emerald-700 pl-3">
                        <span className="truncate mr-2">
                          {line.label}
                          {line.percent != null && (
                            <span className="text-emerald-600/70"> −{line.percent}%</span>
                          )}
                        </span>
                        <span className="font-medium tabular-nums whitespace-nowrap">
                          {effectiveCarrierPrice === 0 && line.percent === 100
                            ? "Offerte"
                            : `−${line.amount.toFixed(2)} €`}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-100 pt-2">
                      <span className="text-slate-700 font-medium">
                        Livraison après remise commerciale
                      </span>
                      <span className="font-semibold tabular-nums">
                        {shipAfterClient === 0 ? t("summaryFree") : `${shipAfterClient.toFixed(2)} €`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* ─── SECTION TAXES + TOTAL TTC — masquée sur l'étape 1 ─────────── */}
      {currentStep >= 2 && (
        <>
          <div className="h-px bg-slate-200 my-4" />
          <div className="space-y-2 text-sm">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
              Taxes ({tvaLabel})
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">TVA sur panier</span>
              <span className="font-medium tabular-nums">{tvaOnCart.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">TVA sur livraison</span>
              <span className="font-medium tabular-nums">{tvaOnShipping.toFixed(2)} €</span>
            </div>
          </div>

          <div className="h-px bg-slate-200 my-4" />
          <div className="flex justify-between items-baseline">
            <span className="font-semibold text-slate-900">{t("summaryTotal")}</span>
            <span className="font-heading font-bold text-2xl text-slate-900 tabular-nums">
              {totalTTC.toFixed(2)} €
            </span>
          </div>
        </>
      )}

      {/* CTA principal + retour */}
      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={onCta}
          disabled={ctaDisabled}
          className="w-full h-11 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ctaLabel}
        </button>
        {onBack && backLabel && (
          <button
            type="button"
            onClick={onBack}
            className="w-full h-10 rounded-xl text-slate-500 text-sm hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            {backLabel}
          </button>
        )}
      </div>

      {helperNote && (
        <p className="mt-4 text-xs text-slate-500 text-center">{helperNote}</p>
      )}

      <ul className="mt-6 space-y-1.5 text-xs text-slate-500">
        <li className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {t("trustSecure")}
        </li>
        <li className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h3.75L8.25 9.75H3.375m0 4.5V5.625c0-.621.504-1.125 1.125-1.125h9.75c.621 0 1.125.504 1.125 1.125v4.125m-13.5 4.5h13.5m0 0l1.125-4.5h2.25c.621 0 1.125.504 1.125 1.125v3.375" />
          </svg>
          {t("trustShipping")}
        </li>
      </ul>
    </aside>
  );
}
