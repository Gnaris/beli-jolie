"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmBankTransfer } from "@/app/actions/admin/bank-transfer";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

export default function BankTransferConfirmButton({
  orderId,
  totalTTC,
}: {
  orderId: string;
  totalTTC: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [isPending, startTransition] = useTransition();

  const handleClick = async () => {
    const ok = await confirm({
      title: "Marquer le virement comme reçu ?",
      message: `Vérifiez d'abord sur votre banque que la somme de ${totalTTC.toFixed(2)} € a bien été créditée. La commande passera en « Paiement reçu » et un email de confirmation partira au client.`,
      confirmLabel: "Oui, virement reçu",
      cancelLabel: "Retour",
    });
    if (!ok) return;

    showLoading();
    startTransition(async () => {
      try {
        const res = await confirmBankTransfer(orderId);
        if (!res.success) {
          toast.error("Erreur", res.error ?? "Impossible de confirmer.");
          return;
        }
        toast.success("Virement confirmé", "Le client va recevoir un email de confirmation.");
        router.refresh();
      } finally {
        hideLoading();
      }
    });
  };

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
      </svg>
      {isPending ? "…" : "Marquer virement reçu"}
    </button>
  );
}
