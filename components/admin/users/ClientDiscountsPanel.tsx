"use client";

import { useState, useTransition } from "react";
import { updateClientDiscount } from "@/app/actions/admin/updateClientDiscount";
import type { ClientDiscountType, ClientDiscountMode } from "@prisma/client";
import { useToast } from "@/components/ui/Toast";

/**
 * Panneau à 2 cartes (Remise produits + Remise livraison), style Ardoise.
 * Chaque remise a 3 modes : PERMANENT / THRESHOLD / NEXT_ORDER + type %/€ + valeur.
 * En cas de THRESHOLD : montant min ou quantité min.
 * Un switch bonus « livraison entièrement offerte » remplace la remise livraison.
 */

interface Props {
  userId: string;
  initialDiscountType:         ClientDiscountType | null;
  initialDiscountValue:        number | null;
  initialDiscountMode:         ClientDiscountMode | null;
  initialDiscountMinAmount:    number | null;
  initialDiscountMinQuantity:  number | null;
  initialFreeShipping:              boolean;
  initialFreeShippingMaxPrice:      number | null;
  initialShippingDiscountType:      ClientDiscountType | null;
  initialShippingDiscountValue:     number | null;
  initialShippingDiscountMode:      ClientDiscountMode | null;
  initialShippingDiscountMinAmount: number | null;
  initialShippingDiscountMinQuantity: number | null;
}

type Mode = "PERMANENT" | "THRESHOLD" | "NEXT_ORDER";
const MODE_LABEL: Record<Mode, string> = {
  PERMANENT:  "Permanente",
  THRESHOLD:  "Sous conditions",
  NEXT_ORDER: "Prochaine cmd",
};

export default function ClientDiscountsPanel(props: Props) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // ─── Remise produits ──────────────────────────────
  const [pEnabled, setPEnabled] = useState(!!props.initialDiscountType);
  const [pMode, setPMode] = useState<Mode>((props.initialDiscountMode as Mode) ?? "PERMANENT");
  const [pType, setPType] = useState<ClientDiscountType>(props.initialDiscountType ?? "PERCENT");
  const [pValue, setPValue] = useState(props.initialDiscountValue?.toString() ?? "");
  const [pMinAmount, setPMinAmount] = useState(props.initialDiscountMinAmount?.toString() ?? "");
  const [pMinQty, setPMinQty] = useState(props.initialDiscountMinQuantity?.toString() ?? "");

  // ─── Remise livraison ─────────────────────────────
  const initialShipEnabled = !!props.initialShippingDiscountType || props.initialFreeShipping;
  const [sEnabled, setSEnabled] = useState(initialShipEnabled);
  const [sMode, setSMode] = useState<Mode>((props.initialShippingDiscountMode as Mode) ?? "PERMANENT");
  const [sType, setSType] = useState<ClientDiscountType>(props.initialShippingDiscountType ?? "PERCENT");
  const [sValue, setSValue] = useState(
    props.initialShippingDiscountValue?.toString() ?? (props.initialFreeShipping ? "100" : "")
  );
  const [sMinAmount, setSMinAmount] = useState(props.initialShippingDiscountMinAmount?.toString() ?? "");
  const [sMinQty, setSMinQty] = useState(props.initialShippingDiscountMinQuantity?.toString() ?? "");
  const [freeShipping, setFreeShipping] = useState(props.initialFreeShipping);
  const [freeShippingMaxPrice, setFreeShippingMaxPrice] = useState(
    props.initialFreeShippingMaxPrice?.toString() ?? "",
  );

  // Auto-sync : cocher « livraison entièrement offerte » ↔ valeur remise = 100 %.
  // Sens 1 : dès qu'on écrit ≥ 100 en % dans la valeur → coche automatiquement.
  function handleShippingValueChange(next: string) {
    setSValue(next);
    if (sType === "PERCENT") {
      const num = parseFloat(next);
      if (Number.isFinite(num) && num >= 100 && !freeShipping) {
        setFreeShipping(true);
      }
    }
  }
  // Sens 2 : dès qu'on active la case → valeur remise passe à 100 %.
  function handleFreeShippingToggle(next: boolean) {
    setFreeShipping(next);
    if (next) {
      setSType("PERCENT");
      setSValue("100");
    } else if (sValue === "100" && sType === "PERCENT") {
      // Reset visuel : on décoche → on vide la valeur pour éviter d'avoir
      // 100 % fantôme sans la case.
      setSValue("");
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await updateClientDiscount(props.userId, {
        discountType:      pEnabled ? pType : null,
        discountValue:     pEnabled && pValue ? parseFloat(pValue) : null,
        discountMode:      pEnabled ? pMode : null,
        discountMinAmount: pEnabled && pMode === "THRESHOLD" && pMinAmount ? parseFloat(pMinAmount) : null,
        discountMinQuantity: pEnabled && pMode === "THRESHOLD" && pMinQty ? parseInt(pMinQty) : null,

        shippingDiscountType:  sEnabled && !freeShipping ? sType : null,
        shippingDiscountValue: sEnabled && !freeShipping && sValue ? parseFloat(sValue) : null,
        shippingDiscountMode:  sEnabled && !freeShipping ? sMode : null,
        shippingDiscountMinAmount:   sEnabled && !freeShipping && sMode === "THRESHOLD" && sMinAmount ? parseFloat(sMinAmount) : null,
        shippingDiscountMinQuantity: sEnabled && !freeShipping && sMode === "THRESHOLD" && sMinQty ? parseInt(sMinQty) : null,
        freeShipping,
        freeShippingMaxPrice: freeShipping && freeShippingMaxPrice ? parseFloat(freeShippingMaxPrice) : null,
      });
      if (res.success) toast.success("Remises enregistrées", "Les paramètres commerciaux ont été mis à jour.");
      else toast.error("Erreur", res.error);
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ═══ REMISE PRODUITS ═══ */}
      <DiscountCard
        title="Remise sur les produits"
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
          </svg>
        }
        badge={pEnabled
          ? { text: `Active · ${pValue || "?"} ${pType === "PERCENT" ? "%" : "€"}`, tone: "success" as const }
          : { text: "Aucune remise", tone: "neutral" as const }
        }
        enabled={pEnabled}
        onToggle={setPEnabled}
      >
        {pEnabled && (
          <>
            <ModePicker mode={pMode} onChange={setPMode} />
            <TypeValueRow type={pType} value={pValue} onTypeChange={setPType} onValueChange={setPValue} />
            {pMode === "THRESHOLD" && (
              <ThresholdBox
                minAmount={pMinAmount} minQty={pMinQty}
                onMinAmountChange={setPMinAmount} onMinQtyChange={setPMinQty}
              />
            )}
            {pMode === "NEXT_ORDER" && (
              <p className="text-[11px] text-text-muted italic">Retirée automatiquement après la prochaine commande.</p>
            )}
          </>
        )}
      </DiscountCard>

      {/* ═══ REMISE LIVRAISON ═══ */}
      <DiscountCard
        title="Remise sur la livraison"
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0M15.75 18.75a1.5 1.5 0 01-3 0M6 3h11.25c.621 0 1.125.504 1.125 1.125V17.25M6 3H4.5A1.5 1.5 0 003 4.5v11.25M6 3v13.5M18.375 17.25h.375a1.5 1.5 0 001.5-1.5v-3.75a1.5 1.5 0 00-.44-1.06l-2.914-2.915a1.5 1.5 0 00-1.06-.44H18.375V17.25z" />
          </svg>
        }
        badge={freeShipping
          ? { text: "Livraison offerte", tone: "success" as const }
          : sEnabled
            ? { text: `Active · ${sValue || "?"} ${sType === "PERCENT" ? "%" : "€"}`, tone: "success" as const }
            : { text: "Aucune remise", tone: "neutral" as const }
        }
        enabled={sEnabled}
        onToggle={setSEnabled}
      >
        {sEnabled && (
          <>
            <div className={freeShipping ? "opacity-40 pointer-events-none" : ""}>
              <ModePicker mode={sMode} onChange={setSMode} />
              <div className="mt-3">
                <TypeValueRow type={sType} value={sValue} onTypeChange={setSType} onValueChange={handleShippingValueChange} />
              </div>
              {sMode === "THRESHOLD" && (
                <div className="mt-3">
                  <ThresholdBox
                    minAmount={sMinAmount} minQty={sMinQty}
                    onMinAmountChange={setSMinAmount} onMinQtyChange={setSMinQty}
                  />
                </div>
              )}
              {sMode === "NEXT_ORDER" && (
                <p className="text-[11px] text-text-muted italic mt-2">Retirée automatiquement après la prochaine commande.</p>
              )}
            </div>

            {/* Livraison offerte : switch qui remplace tout + cap € */}
            <div className="rounded-xl bg-bg-tertiary border border-border p-3 mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">Ou : livraison entièrement offerte</p>
                  <p className="text-[11px] text-text-muted mt-0.5">Remplace la remise ci-dessus par une livraison à 0 €.</p>
                </div>
                <Switch checked={freeShipping} onChange={handleFreeShippingToggle} />
              </div>
              {freeShipping && (
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                    Livraison offerte si le frais de port est inférieur à…
                  </p>
                  <div className="flex items-center border border-border-strong rounded-lg overflow-hidden bg-white">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={freeShippingMaxPrice}
                      onChange={(e) => setFreeShippingMaxPrice(e.target.value)}
                      placeholder="Ex : 15 (laisser vide = pas de plafond)"
                      className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
                    />
                    <span className="px-3 py-2 text-xs text-text-muted bg-bg-tertiary border-l border-border">€ HT</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">
                    Empêche la cliente de choisir un transporteur trop cher : si son prix dépasse ce plafond,
                    la livraison redevient payante. Laissez vide pour tout offrir sans limite.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </DiscountCard>

      {/* Bouton d'enregistrement global */}
      <div className="lg:col-span-2 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="btn-primary text-sm"
        >
          {isPending ? "Enregistrement…" : "Enregistrer les remises"}
        </button>
      </div>
    </div>
  );
}

// ─── Carte de remise (wrapper commun) ─────────────────────────────────────
function DiscountCard({
  title, icon, badge, enabled, onToggle, children,
}: {
  title: string;
  icon: React.ReactNode;
  badge: { text: string; tone: "success" | "neutral" };
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const badgeCls = badge.tone === "success"
    ? "badge badge-success"
    : "badge badge-neutral";
  return (
    <div className="card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border bg-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">{icon}</span>
          <h3 className="font-heading text-sm font-semibold text-text-primary truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`${badgeCls} text-[11px]`}>{badge.text}</span>
          <Switch checked={enabled} onChange={onToggle} />
        </div>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        {children}
      </div>
    </div>
  );
}

// ─── Mode picker (chip group) ─────────────────────────────────────────────
function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Quand appliquer la remise</p>
      <div className="grid grid-cols-3 gap-1 p-1 bg-bg-tertiary rounded-lg border border-border w-full">
        {(["PERMANENT", "THRESHOLD", "NEXT_ORDER"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`px-2 py-1.5 rounded-md text-[11px] sm:text-xs font-medium transition-all leading-tight ${
              mode === m
                ? "bg-bg-primary text-text-primary shadow-sm font-semibold"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Type %/€ + valeur ────────────────────────────────────────────────────
function TypeValueRow({
  type, value, onTypeChange, onValueChange,
}: {
  type: ClientDiscountType;
  value: string;
  onTypeChange: (t: ClientDiscountType) => void;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Type</p>
        <div className="flex rounded-lg border border-border-strong overflow-hidden">
          <button
            type="button"
            onClick={() => { onTypeChange("PERCENT"); onValueChange(""); }}
            className={`flex-1 py-2 text-xs font-medium transition ${
              type === "PERCENT" ? "bg-text-primary text-white" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >%</button>
          <button
            type="button"
            onClick={() => { onTypeChange("AMOUNT"); onValueChange(""); }}
            className={`flex-1 py-2 text-xs font-medium transition ${
              type === "AMOUNT" ? "bg-text-primary text-white" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >€</button>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Valeur</p>
        <div className="flex items-center border border-border-strong rounded-lg overflow-hidden bg-white">
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={type === "PERCENT" ? "100" : undefined}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={type === "PERCENT" ? "10" : "50"}
            className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
          />
          <span className="px-3 py-2 text-xs text-text-muted bg-bg-tertiary border-l border-border">
            {type === "PERCENT" ? "%" : "€"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Bloc conditions (THRESHOLD) ──────────────────────────────────────────
function ThresholdBox({
  minAmount, minQty, onMinAmountChange, onMinQtyChange,
}: {
  minAmount: string;
  minQty: string;
  onMinAmountChange: (v: string) => void;
  onMinQtyChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl bg-bg-tertiary border border-border p-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Conditions à remplir (au moins une)</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
          <span className="px-2.5 py-2 text-xs text-text-muted bg-bg-secondary border-r border-border">≥</span>
          <input
            type="number"
            min="0" step="0.01"
            value={minAmount}
            onChange={(e) => onMinAmountChange(e.target.value)}
            placeholder="Montant"
            className="flex-1 px-2 py-2 text-sm outline-none bg-transparent min-w-0"
          />
          <span className="px-2 py-2 text-[11px] text-text-muted bg-bg-secondary border-l border-border whitespace-nowrap">€ HT</span>
        </div>
        <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
          <span className="px-2.5 py-2 text-xs text-text-muted bg-bg-secondary border-r border-border">≥</span>
          <input
            type="number"
            min="1" step="1"
            value={minQty}
            onChange={(e) => onMinQtyChange(e.target.value)}
            placeholder="Quantité"
            className="flex-1 px-2 py-2 text-sm outline-none bg-transparent min-w-0"
          />
          <span className="px-2 py-2 text-[11px] text-text-muted bg-bg-secondary border-l border-border whitespace-nowrap">articles</span>
        </div>
      </div>
    </div>
  );
}

// ─── Switch ───────────────────────────────────────────────────────────────
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-text-primary" : "bg-border-strong"
      }`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
        checked ? "translate-x-5" : "translate-x-0.5"
      }`} />
    </button>
  );
}
