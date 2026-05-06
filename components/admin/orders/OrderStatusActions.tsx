"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/app/actions/admin/orders";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

const TRANSITIONS: Record<string, { next: string; label: string; variant: string }[]> = {
  PENDING: [
    { next: "SHIPPED",   label: "Marquer comme expédiée", variant: "btn-primary" },
    { next: "CANCELLED", label: "Annuler",                variant: "btn-danger"  },
  ],
  SHIPPED: [
    { next: "PENDING",   label: "Remettre en « Nouveau »", variant: "btn-secondary" },
  ],
  CANCELLED: [],
};

export default function OrderStatusActions({
  orderId,
  currentStatus,
}: {
  orderId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const actions = TRANSITIONS[currentStatus] ?? [];
  if (actions.length === 0) return null;

  async function handleUpdate(nextStatus: string) {
    if (nextStatus === "CANCELLED") {
      const ok = await confirm({
        type: "danger",
        title: "Annuler cette commande ?",
        message: "Cette action est irréversible. La commande sera définitivement annulée.",
        confirmLabel: "Annuler la commande",
        cancelLabel: "Retour",
      });
      if (!ok) return;
    }
    if (currentStatus === "SHIPPED" && nextStatus === "PENDING") {
      const ok = await confirm({
        title: "Remettre la commande en « Nouveau » ?",
        message:
          "La commande repassera en « En attente » côté client et redeviendra modifiable depuis cette page.",
        confirmLabel: "Remettre en Nouveau",
        cancelLabel: "Retour",
      });
      if (!ok) return;
    }
    showLoading();
    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, nextStatus);
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.next}
          type="button"
          disabled={isPending}
          onClick={() => handleUpdate(action.next)}
          className={`${action.variant} text-xs px-4 py-2.5 rounded-lg disabled:opacity-50`}
        >
          {isPending ? "…" : action.label}
        </button>
      ))}
    </div>
  );
}
