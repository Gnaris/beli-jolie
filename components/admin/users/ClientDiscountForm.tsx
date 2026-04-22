"use client";

import { useState, useTransition } from "react";
import { updateClientDiscount } from "@/app/actions/admin/updateClientDiscount";
import type { ClientDiscountType, ClientDiscountMode } from "@prisma/client";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  userId: string;
  initialDiscountType:         ClientDiscountType | null;
  initialDiscountValue:        number | null;
  initialDiscountMode:         ClientDiscountMode | null;
  initialDiscountMinAmount:    number | null;
  initialDiscountMinQuantity:  number | null;
  initialFreeShipping:         boolean;
  initialShippingDiscountType:  ClientDiscountType | null;
  initialShippingDiscountValue: number | null;
}

type DiscountModeTab = "PERMANENT" | "THRESHOLD" | "NEXT_ORDER";

const MODE_TABS: { value: DiscountModeTab; label: string; desc: string }[] = [
  { value: "PERMANENT",  label: "Permanente",        desc: "Sur toutes les commandes" },
  { value: "THRESHOLD",  label: "A partir de…",      desc: "Sous conditions de montant ou quantité" },
  { value: "NEXT_ORDER", label: "Prochaine commande", desc: "Une seule fois, puis retirée" },
];

export default function ClientDiscountForm({
  userId,
  initialDiscountType,
  initialDiscountValue,
  initialDiscountMode,
  initialDiscountMinAmount,
  initialDiscountMinQuantity,
  initialFreeShipping,
  initialShippingDiscountType,
  initialShippingDiscountValue,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Product discount
  const [enabled, setEnabled] = useState(!!initialDiscountType);
  const [mode, setMode] = useState<DiscountModeTab>(initialDiscountMode ?? "PERMANENT");
  const [discountType, setDiscountType] = useState<ClientDiscountType>(initialDiscountType ?? "PERCENT");
  const [discountValue, setDiscountValue] = useState<string>(initialDiscountValue?.toString() ?? "");
  const [minAmount, setMinAmount] = useState<string>(initialDiscountMinAmount?.toString() ?? "");
  const [minQuantity, setMinQuantity] = useState<string>(initialDiscountMinQuantity?.toString() ?? "");

  // Shipping discount
  const hasInitialShipping = !!initialShippingDiscountType || initialFreeShipping;
  const [shippingEnabled, setShippingEnabled] = useState(hasInitialShipping);
  const [shippingType, setShippingType] = useState<ClientDiscountType>(
    initialShippingDiscountType ?? (initialFreeShipping ? "PERCENT" : "PERCENT")
  );
  const [shippingValue, setShippingValue] = useState<string>(
    initialShippingDiscountValue != null
      ? initialShippingDiscountValue.toString()
      : (initialFreeShipping ? "100" : "")
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    showLoading();
    startTransition(async () => {
      try {
        const res = await updateClientDiscount(userId, {
          discountType:      enabled ? discountType : null,
          discountValue:     enabled ? (discountValue ? parseFloat(discountValue) : null) : null,
          discountMode:      enabled ? mode : null,
          discountMinAmount: enabled && mode === "THRESHOLD" && minAmount ? parseFloat(minAmount) : null,
          discountMinQuantity: enabled && mode === "THRESHOLD" && minQuantity ? parseInt(minQuantity) : null,
          shippingDiscountType:  shippingEnabled ? shippingType : null,
          shippingDiscountValue: shippingEnabled && shippingValue ? parseFloat(shippingValue) : null,
          freeShipping: shippingEnabled && shippingType === "PERCENT" && parseFloat(shippingValue || "0") >= 100,
        });
        if (res.success) {
          toast.success("Remise enregistrée", "La remise a été mise à jour.");
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleRemoveAll() {
    setEnabled(false);
    setDiscountValue("");
    setMinAmount("");
    setMinQuantity("");
    setShippingEnabled(false);
    setShippingValue("");

    showLoading();
    startTransition(async () => {
      try {
        const res = await updateClientDiscount(userId, {
          discountType: null, discountValue: null, discountMode: null,
          discountMinAmount: null, discountMinQuantity: null,
          shippingDiscountType: null, shippingDiscountValue: null,
          freeShipping: false,
        });
        if (res.success) {
          toast.success("Remises supprimées", "Toutes les remises ont été retirées.");
        } else {
          toast.error("Erreur", res.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  const hasExisting = initialDiscountType || initialFreeShipping || initialShippingDiscountType;

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-5">

      {/* ── Remise produits ── */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
              enabled ? "bg-accent" : "bg-border-dark"
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
          <span className="text-sm font-body font-medium text-text-primary">
            Remise sur les produits
          </span>
        </div>

        {enabled && (
          <div className="space-y-4 pl-14">
            {/* Mode tabs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {MODE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setMode(tab.value)}
                  className={`text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                    mode === tab.value
                      ? "border-accent bg-accent/5"
                      : "border-border bg-bg-primary hover:border-border-dark"
                  }`}
                >
                  <span className={`block text-sm font-body font-semibold ${
                    mode === tab.value ? "text-text-primary" : "text-text-secondary"
                  }`}>{tab.label}</span>
                  <span className="block text-xs font-body text-text-muted mt-0.5">{tab.desc}</span>
                </button>
              ))}
            </div>

            {/* Type % or € */}
            <div className="flex gap-2">
              {(["PERCENT", "AMOUNT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setDiscountType(type); setDiscountValue(""); }}
                  className={`px-4 py-2 rounded-lg border text-sm font-body transition-colors ${
                    discountType === type
                      ? "border-accent bg-accent text-text-inverse"
                      : "border-border bg-bg-primary text-text-primary hover:border-border-dark"
                  }`}
                >
                  {type === "PERCENT" ? "%" : "€"}
                </button>
              ))}
            </div>

            {/* Value */}
            <div className="relative max-w-xs">
              <input
                type="number"
                min="0.01"
                max={discountType === "PERCENT" ? "100" : undefined}
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "PERCENT" ? "ex : 10" : "ex : 50"}
                required
                className="field-input w-full pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted pointer-events-none">
                {discountType === "PERCENT" ? "%" : "€"}
              </span>
            </div>

            {/* THRESHOLD conditions */}
            {mode === "THRESHOLD" && (
              <div className="space-y-3 p-3 rounded-xl bg-bg-secondary border border-border">
                <p className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider">Conditions (au moins une)</p>
                <div>
                  <label htmlFor="minAmount" className="block text-xs font-body text-text-secondary mb-1">
                    Montant minimum HT
                  </label>
                  <div className="relative max-w-xs">
                    <input
                      id="minAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={minAmount}
                      onChange={(e) => setMinAmount(e.target.value)}
                      placeholder="ex : 500"
                      className="field-input w-full pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted pointer-events-none">€</span>
                  </div>
                </div>
                <div>
                  <label htmlFor="minQty" className="block text-xs font-body text-text-secondary mb-1">
                    Nombre minimum d&apos;articles
                  </label>
                  <div className="relative max-w-xs">
                    <input
                      id="minQty"
                      type="number"
                      min="1"
                      step="1"
                      value={minQuantity}
                      onChange={(e) => setMinQuantity(e.target.value)}
                      placeholder="ex : 10"
                      className="field-input w-full pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-text-muted pointer-events-none">articles</span>
                  </div>
                </div>
              </div>
            )}

            {/* NEXT_ORDER info */}
            {mode === "NEXT_ORDER" && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <p className="text-xs text-blue-700 font-body">
                  Retirée automatiquement après la prochaine commande.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Remise livraison ── */}
      <div className="pt-4 border-t border-border-light">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={shippingEnabled}
            onClick={() => setShippingEnabled(!shippingEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
              shippingEnabled ? "bg-accent" : "bg-border-dark"
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              shippingEnabled ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
          <span className="text-sm font-body font-medium text-text-primary">
            Remise sur la livraison
          </span>
        </div>

        {shippingEnabled && (
          <div className="space-y-3 pl-14">
            <div className="flex gap-2">
              {(["PERCENT", "AMOUNT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setShippingType(type); setShippingValue(""); }}
                  className={`px-4 py-2 rounded-lg border text-sm font-body transition-colors ${
                    shippingType === type
                      ? "border-accent bg-accent text-text-inverse"
                      : "border-border bg-bg-primary text-text-primary hover:border-border-dark"
                  }`}
                >
                  {type === "PERCENT" ? "%" : "€"}
                </button>
              ))}
            </div>

            <div className="relative max-w-xs">
              <input
                type="number"
                min="0.01"
                max={shippingType === "PERCENT" ? "100" : undefined}
                step="0.01"
                value={shippingValue}
                onChange={(e) => setShippingValue(e.target.value)}
                placeholder={shippingType === "PERCENT" ? "100 = offerte" : "ex : 5"}
                required
                className="field-input w-full pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted pointer-events-none">
                {shippingType === "PERCENT" ? "%" : "€"}
              </span>
            </div>

            {shippingType === "PERCENT" && parseFloat(shippingValue || "0") >= 100 && (
              <p className="text-xs text-accent font-body font-medium">
                Livraison entièrement offerte
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary text-sm"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={handleRemoveAll}
            disabled={isPending}
            className="btn-secondary text-sm"
          >
            Tout supprimer
          </button>
        )}
      </div>
    </form>
  );
}
