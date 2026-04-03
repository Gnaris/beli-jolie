"use client";

import { useState, useTransition } from "react";
import { adjustStock } from "@/app/actions/admin/stock";
import { useToast } from "@/components/ui/Toast";

interface StockAdjustModalProps {
  productColorId: string;
  currentStock: number;
  variantLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function StockAdjustModal({
  productColorId,
  currentStock,
  variantLabel,
  onClose,
  onSuccess,
}: StockAdjustModalProps) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();

  const parsedQty = parseInt(quantity, 10);
  const isValid = !isNaN(parsedQty) && parsedQty !== 0 && reason.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    startTransition(async () => {
      const result = await adjustStock(productColorId, parsedQty, reason);
      if (result.success) {
        addToast("Stock ajusté avec succès", "success");
        onSuccess();
        onClose();
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-2xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-lg font-bold text-text-primary mb-1">
          Ajuster le stock
        </h3>
        <p className="text-sm text-text-muted font-body mb-4">
          {variantLabel} — Stock actuel : <span className="font-semibold text-text-primary">{currentStock}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">
              Quantite (+/-)
            </label>
            <input
              type="number"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="ex: 10 ou -5"
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body"
              autoFocus
            />
            {quantity && !isNaN(parsedQty) && parsedQty !== 0 && (
              <p className="text-xs text-text-muted mt-1 font-body">
                Nouveau stock : <span className="font-semibold">{currentStock + parsedQty}</span>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">
              Raison *
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Reception fournisseur, Inventaire..."
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg focus:outline-none focus:border-[#1A1A1A] text-text-primary font-body"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-body text-text-muted hover:text-text-primary transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!isValid || isPending}
              className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors"
            >
              {isPending ? "..." : "Ajuster"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
