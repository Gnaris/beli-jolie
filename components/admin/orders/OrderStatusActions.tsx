"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/app/actions/admin/orders";

const TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
  PENDING:    [{ next: "PROCESSING", label: "Passer en préparation", color: "bg-blue-600 hover:bg-blue-700" }, { next: "CANCELLED", label: "Annuler", color: "bg-red-600 hover:bg-red-700" }],
  PROCESSING: [{ next: "SHIPPED",    label: "Marquer comme expédiée", color: "bg-[#5E8470] hover:bg-[#4a7059]" }, { next: "CANCELLED", label: "Annuler", color: "bg-red-600 hover:bg-red-700" }],
  SHIPPED:    [{ next: "DELIVERED",  label: "Marquer comme livrée",   color: "bg-[#5E8470] hover:bg-[#4a7059]" }],
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
          className={`text-white text-xs font-[family-name:var(--font-roboto)] font-medium px-3 py-1.5 transition-colors disabled:opacity-50 ${action.color}`}
        >
          {isPending ? "…" : action.label}
        </button>
      ))}
    </div>
  );
}
