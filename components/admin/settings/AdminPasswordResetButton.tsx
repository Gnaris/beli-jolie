"use client";
import { useState, useTransition } from "react";
import { sendAdminPasswordReset } from "@/app/actions/admin/send-password-reset";

export default function AdminPasswordResetButton() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function handleClick() {
    setSent(false);
    setError("");
    startTransition(async () => {
      const result = await sendAdminPasswordReset();
      if (result.success) {
        setSent(true);
        setTimeout(() => setSent(false), 5000);
      } else {
        setError(result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? "Envoi en cours..." : "Envoyer un lien de réinitialisation"}
      </button>
      {sent && (
        <p className="text-sm text-[#22C55E] font-[family-name:var(--font-roboto)]">
          Email envoyé ! Vérifiez votre boîte de réception.
        </p>
      )}
      {error && (
        <p className="text-sm text-[#EF4444] font-[family-name:var(--font-roboto)]">{error}</p>
      )}
    </div>
  );
}
