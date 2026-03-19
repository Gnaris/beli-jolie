"use client";
import { useTransition } from "react";
import { sendAdminPasswordReset } from "@/app/actions/admin/send-password-reset";
import { useToast } from "@/components/ui/Toast";

export default function AdminPasswordResetButton() {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function handleClick() {
    startTransition(async () => {
      const result = await sendAdminPasswordReset();
      if (result.success) {
        toast.success("Email envoyé", "Vérifiez votre boîte de réception.");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
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
