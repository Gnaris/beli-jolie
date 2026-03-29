"use client";
import { useTransition } from "react";
import { sendAdminPasswordReset } from "@/app/actions/admin/send-password-reset";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

export default function AdminPasswordResetButton() {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleClick() {
    showLoading();
    startTransition(async () => {
      try {
        const result = await sendAdminPasswordReset();
        if (result.success) {
          toast.success("Email envoyé", "Vérifiez votre boîte de réception.");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="btn-secondary"
    >
      {pending ? "Envoi en cours..." : "Envoyer un lien de réinitialisation"}
    </button>
  );
}
