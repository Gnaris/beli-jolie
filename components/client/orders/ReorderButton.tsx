"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { reorderFromOrder } from "@/app/actions/client/reorder";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function ReorderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const t = useTranslations("orders");

  async function handleReorder() {
    const result = await confirm({
      type: "info",
      title: t("reorderConfirmTitle"),
      message: t("reorderConfirmMessage"),
      confirmLabel: t("reorderReplace"),
      secondaryAction: { label: t("reorderMerge"), style: "neutral" },
      cancelLabel: t("reorderCancel"),
    });

    // false = cancel (backdrop, Escape, or cancel button)
    if (result === false) return;

    const selectedMode = result === true ? "replace" : "merge";

    startTransition(async () => {
      const res = await reorderFromOrder(orderId, selectedMode);
      if (res.success) {
        toast.success(res.message || t("reorderSuccess"));
        if (res.warnings && res.warnings.length > 0) {
          res.warnings.forEach((w) => toast.warning(w));
        }
        router.push("/panier");
      } else {
        toast.error(res.error || t("reorderError"));
      }
    });
  }

  return (
    <button
      onClick={handleReorder}
      disabled={isPending}
      className="flex items-center gap-1.5 text-xs font-body text-text-secondary hover:text-accent hover:border-accent transition-colors border border-border rounded-lg px-3 py-1.5 disabled:opacity-40"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
      {isPending ? "..." : t("reorder")}
    </button>
  );
}
