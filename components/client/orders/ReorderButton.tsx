"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { reorderFromOrder } from "@/app/actions/client/reorder";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function ReorderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();

  async function handleReorder() {
    const mode = await confirm({
      title: "Commander à nouveau ?",
      message: "Voulez-vous remplacer votre panier actuel ou fusionner les articles ?",
      confirmLabel: "Remplacer le panier",
      cancelLabel: "Fusionner avec le panier",
    });

    const selectedMode = mode ? "replace" : "merge";

    startTransition(async () => {
      const result = await reorderFromOrder(orderId, selectedMode);
      if (result.success) {
        toast.success(result.message || "Articles ajoutes au panier");
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((w) => toast.warning(w));
        }
        router.push("/panier");
      } else {
        toast.error(result.error || "Erreur");
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
