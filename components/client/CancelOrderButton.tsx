"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { cancelOrder } from "@/app/actions/client/order";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  orderId: string;
  orderNumber: string;
}

export default function CancelOrderButton({ orderId, orderNumber }: Props) {
  const t = useTranslations("cancelOrder");
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  function handleCancel() {
    setError("");
    showLoading();
    startTransition(async () => {
      try {
        await cancelOrder(orderId);
        setConfirm(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("error"));
        setConfirm(false);
      } finally {
        hideLoading();
      }
    });
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-body text-text-secondary">
          {t("confirmTitle", { orderNumber })}
        </span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isPending}
          className="text-xs font-body font-medium text-[#EF4444] hover:text-[#DC2626] border border-[#FECACA] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
        >
          {isPending ? t("cancelling") : t("confirm")}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="text-xs font-body text-text-muted hover:text-text-secondary transition-colors"
        >
          {t("keep")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="flex items-center gap-1.5 text-xs font-body text-text-muted hover:text-[#EF4444] transition-colors border border-border rounded-lg px-3 py-1.5 hover:border-[#FECACA]"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M6 18L18 6M6 6l12 12" />
        </svg>
        {t("button")}
      </button>
      {error && <p className="text-[10px] text-[#EF4444] mt-1 font-body">{error}</p>}
    </div>
  );
}
