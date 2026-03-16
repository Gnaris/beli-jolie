"use client";

import { useState, useTransition } from "react";
import { cancelOrder } from "@/app/actions/client/order";

interface Props {
  orderId: string;
  orderNumber: string;
}

export default function CancelOrderButton({ orderId, orderNumber }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  function handleCancel() {
    setError("");
    startTransition(async () => {
      try {
        await cancelOrder(orderId);
        setConfirm(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Erreur");
        setConfirm(false);
      }
    });
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B]">
          Annuler {orderNumber} ?
        </span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#EF4444] hover:text-[#DC2626] border border-[#FECACA] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
        >
          {isPending ? "Annulation..." : "Confirmer"}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] hover:text-[#6B6B6B] transition-colors"
        >
          Non, garder
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="flex items-center gap-1.5 text-xs font-[family-name:var(--font-roboto)] text-[#9CA3AF] hover:text-[#EF4444] transition-colors border border-[#E5E5E5] rounded-lg px-3 py-1.5 hover:border-[#FECACA]"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M6 18L18 6M6 6l12 12" />
        </svg>
        Annuler la commande
      </button>
      {error && <p className="text-[10px] text-[#EF4444] mt-1 font-[family-name:var(--font-roboto)]">{error}</p>}
    </div>
  );
}
