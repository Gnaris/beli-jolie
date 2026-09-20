"use client";

/**
 * Bouton ↻ « Réinitialiser les stades d'inactivité » sur la fiche client.
 * Wipe stagesFired : le cycle repart au Stade 1 dès que le client sera de
 * nouveau détecté comme inactif au prochain tick du worker. Si le client est
 * ACTIF (visite/commande récente), aucun mail ne partira tant qu'il ne
 * retombe pas inactif — comportement voulu.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { resetInactiveClientStagesForUser } from "@/app/actions/admin/inactive-client";

interface Props {
  userId: string;
  userLabel: string;
}

export default function InactiveClientResetButton({ userId, userLabel }: Props) {
  const { confirm } = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  async function onClick() {
    const ok = await confirm({
      title: `Réinitialiser les stades d'inactivité pour ${userLabel} ?`,
      message:
        "Le client repartira au Stade 1 s'il est (ou devient) inactif. Si le client est actif en ce moment, aucun mail n'est envoyé — les stades se rejoueront quand il sera resté inactif assez longtemps.",
      confirmLabel: "Réinitialiser",
      type: "danger",
    });
    if (ok !== true) return;
    setRunning(true);
    const res = await resetInactiveClientStagesForUser(userId);
    setRunning(false);
    if (!res.success) {
      toast.error("Réinitialisation impossible", res.error);
      return;
    }
    toast.success(
      "Stades réinitialisés",
      res.hasStages
        ? "Le cycle repartira au Stade 1 au prochain passage du worker si le client est inactif."
        : "Aucun stade n'est configuré pour ce tenant — configurez-les d'abord dans /admin/marketing/mails/inactivite.",
    );
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      title="Réinitialiser les stades de relance inactivité"
      aria-label={`Réinitialiser les stades de relance inactivité pour ${userLabel}`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300 disabled:opacity-40 transition-colors"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={running ? "animate-spin" : undefined}
      >
        <path d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3" />
        <path d="M21 4v6h-6M3 20v-6h6" />
      </svg>
    </button>
  );
}
