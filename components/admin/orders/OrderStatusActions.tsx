"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/app/actions/admin/orders";

const TRANSITIONS: Record<string, { next: string; label: string; variant: string }[]> = {
  PENDING:    [
    { next: "PROCESSING", label: "Passer en préparation", variant: "btn-primary" },
    { next: "CANCELLED", label: "Annuler", variant: "btn-danger" },
  ],
  PROCESSING: [
    { next: "SHIPPED", label: "Marquer comme expédiée", variant: "btn-primary" },
    { next: "CANCELLED", label: "Annuler", variant: "btn-danger" },
  ],
  SHIPPED:    [{ next: "DELIVERED", label: "Marquer comme livrée", variant: "btn-primary" }],
  DELIVERED:  [],
  CANCELLED:  [],
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

  const actions = TRANSITIONS[currentStatus] ?? [];
  if (actions.length === 0) return null;

  function handleUpdate(nextStatus: string) {
    startTransition(async () => {
      await updateOrderStatus(orderId, nextStatus);
      router.refresh();
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
          className={`${action.variant} text-xs px-3 py-1.5 rounded-lg disabled:opacity-50`}
        >
          {isPending ? "…" : action.label}
        </button>
      ))}
    </div>
  );
}
