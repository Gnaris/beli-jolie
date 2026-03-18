"use client";

import { useState, useTransition } from "react";
import { updateClientDiscount } from "@/app/actions/admin/updateClientDiscount";
import type { ClientDiscountType } from "@prisma/client";

interface Props {
  userId: string;
  initialDiscountType:  ClientDiscountType | null;
  initialDiscountValue: number | null;
  initialFreeShipping:  boolean;
}

export default function ClientDiscountForm({
  userId,
  initialDiscountType,
  initialDiscountValue,
  initialFreeShipping,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [discountType, setDiscountType]   = useState<ClientDiscountType | "">(initialDiscountType ?? "");
  const [discountValue, setDiscountValue] = useState<string>(initialDiscountValue?.toString() ?? "");
  const [freeShipping, setFreeShipping]   = useState(initialFreeShipping);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setError("");

    const parsedValue = discountValue ? parseFloat(discountValue) : null;

    startTransition(async () => {
      const res = await updateClientDiscount(userId, {
        discountType:  discountType || null,
        discountValue: parsedValue,
        freeShipping,
      });
      if (res.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(res.error);
      }
    });
  }

  function handleRemoveDiscount() {
    setDiscountType("");
    setDiscountValue("");
    setFreeShipping(false);
    setSuccess(false);
    setError("");

    startTransition(async () => {
      const res = await updateClientDiscount(userId, {
        discountType:  null,
        discountValue: null,
        freeShipping:  false,
      });
      if (res.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(res.error);
      }
    });
  }

  const hasExistingDiscount = initialDiscountType || initialFreeShipping;

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-4">

      {/* Remise sur montant */}
      <div>
        <label className="block text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-wider mb-2">
          Type de remise
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          {(["", "PERCENT", "AMOUNT"] as const).map((type) => (
            <label
              key={type}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-[family-name:var(--font-roboto)] cursor-pointer transition-colors ${
                discountType === type
                  ? "border-[#1A1A1A] bg-[#1A1A1A] text-white"
                  : "border-border bg-white text-text-primary hover:border-[#9CA3AF]"
              }`}
            >
              <input
                type="radio"
                name="discountType"
                value={type}
                checked={discountType === type}
                onChange={() => { setDiscountType(type); setDiscountValue(""); }}
                className="sr-only"
              />
              {type === ""       && "Aucune remise"}
              {type === "PERCENT" && "Remise en %"}
              {type === "AMOUNT"  && "Remise en €"}
            </label>
          ))}
        </div>
      </div>

      {/* Valeur de la remise */}
      {discountType !== "" && (
        <div>
          <label htmlFor="discountValue" className="block text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            {discountType === "PERCENT" ? "Pourcentage (%)" : "Montant (€)"}
          </label>
          <div className="relative max-w-xs">
            <input
              id="discountValue"
              type="number"
              min="0.01"
              max={discountType === "PERCENT" ? "100" : undefined}
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === "PERCENT" ? "ex: 10" : "ex: 50"}
              required
              className="field-input w-full pr-10"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted pointer-events-none">
              {discountType === "PERCENT" ? "%" : "€"}
            </span>
          </div>
          {discountType === "PERCENT" && (
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-1">
              Appliqué sur le sous-total HT de chaque commande.
            </p>
          )}
          {discountType === "AMOUNT" && (
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-1">
              Déduit du sous-total HT de chaque commande.
            </p>
          )}
        </div>
      )}

      {/* Livraison offerte */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative mt-0.5">
            <input
              type="checkbox"
              checked={freeShipping}
              onChange={(e) => setFreeShipping(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              freeShipping ? "bg-[#1A1A1A] border-[#1A1A1A]" : "border-border bg-white group-hover:border-[#9CA3AF]"
            }`}>
              {freeShipping && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
          <div>
            <span className="text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary">
              Livraison offerte
            </span>
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
              Les frais de livraison seront automatiquement à 0 € pour ce client.
            </p>
          </div>
        </label>
      </div>

      {/* Feedback */}
      {error && (
        <p className="text-xs font-[family-name:var(--font-roboto)] text-error bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg px-3 py-2">
          Remise mise à jour avec succès.
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary text-sm"
        >
          {isPending ? "Enregistrement…" : "Enregistrer la remise"}
        </button>
        {hasExistingDiscount && (
          <button
            type="button"
            onClick={handleRemoveDiscount}
            disabled={isPending}
            className="btn-secondary text-sm"
          >
            Supprimer la remise
          </button>
        )}
      </div>
    </form>
  );
}
