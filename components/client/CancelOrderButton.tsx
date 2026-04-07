"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { cancelOrder } from "@/app/actions/client/order";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

interface Props {
  orderId: string;
  orderNumber: string;
}

export default function CancelOrderButton({ orderId, orderNumber }: Props) {
  const t = useTranslations("cancelOrder");
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const { confirm } = useConfirm();
  const { toast } = useToast();

  async function handleClick() {
    const ok = await confirm({
      type: "danger",
      title: t("confirmTitle", { orderNumber }),
      message: t("confirmMessage"),
      confirmLabel: t("confirm"),
      cancelLabel: t("keep"),
    });
    if (!ok) return;

    showLoading();
    startTransition(async () => {
      try {
        await cancelOrder(orderId);
      } catch (e: unknown) {
        toast(e instanceof Error ? e.message : t("error"), "error");
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="flex items-center gap-1.5 text-xs font-body text-text-muted hover:text-[#EF4444] transition-colors border border-border rounded-lg px-3 py-1.5 hover:border-[#FECACA] disabled:opacity-60"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M6 18L18 6M6 6l12 12" />
      </svg>
      {t("button")}
    </button>
  );
}
