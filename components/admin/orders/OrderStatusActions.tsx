"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/app/actions/admin/orders";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

const TRANSITIONS: Record<string, { next: string; label: string; variant: string }[]> = {
  PENDING: [
    { next: "VALIDATED", label: "Marquer comme validée",   variant: "btn-validate" },
    { next: "SHIPPED",   label: "Marquer comme expédiée",  variant: "btn-primary"  },
    { next: "CANCELLED", label: "Annuler",                 variant: "btn-danger"   },
  ],
  VALIDATED: [
    { next: "SHIPPED",   label: "Marquer comme expédiée",  variant: "btn-primary"   },
    { next: "PENDING",   label: "Remettre en « Nouveau »", variant: "btn-secondary" },
    { next: "CANCELLED", label: "Annuler",                 variant: "btn-danger"    },
  ],
  SHIPPED: [
    { next: "PENDING",   label: "Remettre en « Nouveau »", variant: "btn-secondary" },
  ],
  CANCELLED: [],
};

const BTN_CLASSES: Record<string, string> = {
  "btn-primary":   "btn-primary",
  "btn-secondary": "btn-secondary",
  "btn-danger":    "btn-danger",
  "btn-validate":  "bg-blue-600 text-white hover:bg-blue-700 font-semibold transition-colors",
};

export default function OrderStatusActions({
  orderId,
  currentStatus,
  hasUnconfirmedChanges = false,
}: {
  orderId: string;
  currentStatus: string;
  hasUnconfirmedChanges?: boolean;
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
    if ((currentStatus === "SHIPPED" || currentStatus === "VALIDATED") && nextStatus === "PENDING") {
      const ok = await confirm({
        title: "Remettre la commande en « Nouveau » ?",
        message:
          "La commande repassera en « En attente » côté client et redeviendra modifiable depuis cette page.",
        confirmLabel: "Remettre en Nouveau",
        cancelLabel: "Retour",
      });
      if (!ok) return;
    }
    if (nextStatus === "VALIDATED") {
      const ok = await confirm({
        title: "Marquer la commande comme validée ?",
        message:
          "La commande sera signalée comme prête à expédier et un email de confirmation partira au client.",
        confirmLabel: "Valider la commande",
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
      {actions.map((action) => {
        const isShippedTransition = action.next === "SHIPPED";
        const blocked = isShippedTransition && hasUnconfirmedChanges;
        const btnClass = BTN_CLASSES[action.variant] ?? action.variant;
        return (
          <button
            key={action.next}
            type="button"
            disabled={isPending || blocked}
            onClick={() => handleUpdate(action.next)}
            title={blocked ? "Confirmez d'abord les modifications de la commande" : undefined}
            className={`${btnClass} text-xs px-4 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isPending ? "…" : action.label}
          </button>
        );
      })}
    </div>
  );
}
