"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { reorderFromOrder } from "@/app/actions/client/reorder";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function ReorderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  async function handleReorder() {
    const mode = await confirm(
      "Commander a nouveau ?",
      { confirmLabel: "Remplacer le panier", cancelLabel: "Fusionner avec le panier" }
    );

    const selectedMode = mode ? "replace" : "merge";

    startTransition(async () => {
      const result = await reorderFromOrder(orderId, selectedMode);
      if (result.success) {
        addToast(result.message || "Articles ajoutes au panier", "success");
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((w) => addToast(w, "warning"));
        }
        router.push("/panier");
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  return (
    <button
      onClick={handleReorder}
      disabled={isPending}
      className="px-4 py-2 text-sm font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border disabled:opacity-40 transition-colors"
    >
      {isPending ? "..." : "Commander a nouveau"}
    </button>
  );
}
