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
  mode = "BANK_TRANSFER",
}: {
  orderId: string;
  totalTTC: number;
  /** BANK_TRANSFER = "Marquer virement reçu" ; PAY_ON_PICKUP = "Marquer payé en boutique". */
  mode?: "BANK_TRANSFER" | "PAY_ON_PICKUP";
}) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [isPending, startTransition] = useTransition();

  const isPickup = mode === "PAY_ON_PICKUP";
  const labels = isPickup
    ? {
        confirmTitle: "Marquer comme payé en boutique ?",
        confirmMessage: `Confirmez que la cliente a bien réglé les ${totalTTC.toFixed(2)} € au comptoir lors de son retrait. La commande passera en « Paiement reçu » et un email de confirmation partira au client.`,
        confirmYes: "Oui, payé en boutique",
        buttonLabel: "Marquer payé en boutique",
        toastTitle: "Paiement confirmé",
      }
    : {
        confirmTitle: "Marquer le virement comme reçu ?",
        confirmMessage: `Vérifiez d'abord sur votre banque que la somme de ${totalTTC.toFixed(2)} € a bien été créditée. La commande passera en « Paiement reçu » et un email de confirmation partira au client.`,
        confirmYes: "Oui, virement reçu",
        buttonLabel: "Marquer virement reçu",
        toastTitle: "Virement confirmé",
      };

  const handleClick = async () => {
    const ok = await confirm({
      title: labels.confirmTitle,
      message: labels.confirmMessage,
      confirmLabel: labels.confirmYes,
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
        toast.success(labels.toastTitle, "Le client va recevoir un email de confirmation.");
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
      {isPending ? "…" : labels.buttonLabel}
    </button>
  );
}
