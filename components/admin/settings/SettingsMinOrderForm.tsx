"use client";
import { useMemo, useState, useTransition } from "react";
import { updateMinOrderConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import type { MinOrderConfig, MinOrderMode } from "@/lib/min-order";

interface Props {
  initialConfig: MinOrderConfig;
}

interface ModeOption {
  value: MinOrderMode;
  title: string;
  description: string;
}

const MODES: ModeOption[] = [
  {
    value: "none",
    title: "Aucun minimum",
    description: "Le client peut passer commande à partir de n'importe quel montant.",
  },
  {
    value: "all",
    title: "Un minimum pour toutes les commandes",
    description: "Un seul seuil, appliqué à chaque commande.",
  },
  {
    value: "first_only",
    title: "Minimum uniquement sur la 1ʳᵉ commande",
    description: "Un seuil pour la toute première commande, aucun minimum ensuite.",
  },
  {
    value: "first_then_rest",
    title: "1ʳᵉ commande + commandes suivantes",
    description: "Un seuil pour la 1ʳᵉ commande et un autre pour toutes les suivantes.",
  },
];

function toStr(n: number): string {
  return n > 0 ? String(n) : "";
}

export default function SettingsMinOrderForm({ initialConfig }: Props) {
  const [mode, setMode] = useState<MinOrderMode>(initialConfig.mode);
  const [valueAll, setValueAll] = useState<string>(toStr(initialConfig.valueAll));
  const [valueFirst, setValueFirst] = useState<string>(toStr(initialConfig.valueFirst));
  const [valueRest, setValueRest] = useState<string>(toStr(initialConfig.valueRest));
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const showAll = mode === "all";
  const showFirst = mode === "first_only" || mode === "first_then_rest";
  const showRest = mode === "first_then_rest";

  const hasChanges = useMemo(() => {
    if (mode !== initialConfig.mode) return true;
    if (showAll && parseFloat(valueAll || "0") !== initialConfig.valueAll) return true;
    if (showFirst && parseFloat(valueFirst || "0") !== initialConfig.valueFirst) return true;
    if (showRest && parseFloat(valueRest || "0") !== initialConfig.valueRest) return true;
    return false;
  }, [mode, valueAll, valueFirst, valueRest, showAll, showFirst, showRest, initialConfig]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numAll = parseFloat(valueAll || "0");
    const numFirst = parseFloat(valueFirst || "0");
    const numRest = parseFloat(valueRest || "0");
    if (showAll && (!Number.isFinite(numAll) || numAll <= 0)) {
      toast.error("Montant manquant", "Renseignez le minimum HT.");
      return;
    }
    if (showFirst && (!Number.isFinite(numFirst) || numFirst <= 0)) {
      toast.error("Montant manquant", "Renseignez le minimum de la 1ʳᵉ commande.");
      return;
    }
    if (showRest && (!Number.isFinite(numRest) || numRest <= 0)) {
      toast.error("Montant manquant", "Renseignez le minimum des commandes suivantes.");
      return;
    }
    startTransition(async () => {
      const result = await updateMinOrderConfig({
        mode,
        valueAll: showAll ? numAll : 0,
        valueFirst: showFirst ? numFirst : 0,
        valueRest: showRest ? numRest : 0,
      });
      if (result.success) {
        toast.success("Enregistré", "Le minimum de commande a été mis à jour.");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        {MODES.map((opt) => {
          const active = mode === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-3 cursor-pointer rounded-xl border p-3 transition-colors ${
                active
                  ? "border-text-primary bg-bg-secondary"
                  : "border-border hover:border-text-secondary"
              }`}
            >
              <input
                type="radio"
                name="min-order-mode"
                value={opt.value}
                checked={active}
                onChange={() => setMode(opt.value)}
                className="mt-1 accent-text-primary"
                disabled={isPending}
              />
              <span>
                <span className="block text-sm font-medium text-text-primary font-body">
                  {opt.title}
                </span>
                <span className="block text-xs text-text-secondary font-body mt-0.5">
                  {opt.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {showAll && (
        <AmountField
          id="minOrderHT"
          label="Montant minimum HT"
          value={valueAll}
          onChange={setValueAll}
          disabled={isPending}
        />
      )}

      {showFirst && (
        <AmountField
          id="minOrderHTFirst"
          label="Commande minimum — 1ʳᵉ commande"
          value={valueFirst}
          onChange={setValueFirst}
          disabled={isPending}
        />
      )}

      {showRest && (
        <AmountField
          id="minOrderHTRest"
          label="Commande minimum — commandes suivantes"
          value={valueRest}
          onChange={setValueRest}
          disabled={isPending}
        />
      )}

      <button type="submit" disabled={isPending || !hasChanges} className="btn-primary">
        {isPending ? "Enregistrement..." : "Enregistrer"}
      </button>
    </form>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative max-w-[240px]">
        <input
          id={id}
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field-input pr-14 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          placeholder="0"
          disabled={disabled}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary font-body pointer-events-none">
          € HT
        </span>
      </div>
    </div>
  );
}
