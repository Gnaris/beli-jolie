"use client";

/**
 * Bouton ↻ « Réinitialiser les stades » sur une ligne client de
 * `/admin/marketing`. Modale de confirmation obligatoire (action visible
 * côté client — envoi d'un mail si le panier n'est pas vide).
 *
 * Comportement serveur (voir `resetAbandonedCartStagesForUser`) :
 *   - Panier vide : job passé en CANCELLED cause RESET_ADMIN. Le trigger
 *     redémarrera proprement dès que le client ajoutera un article.
 *   - Panier non-vide : cycle relancé au Stade 1 (timer armé immédiatement).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { resetAbandonedCartStagesForUser } from "@/app/actions/admin/abandoned-cart";

interface Props {
  userId: string;
  userLabel: string;
}

export default function AbandonedCartResetButton({ userId, userLabel }: Props) {
  const { confirm } = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  async function onClick() {
    const ok = await confirm({
      title: `Réinitialiser les stades pour ${userLabel} ?`,
      message:
        "Le client redémarre au Stade 1. Si le panier contient des articles, le nouveau cycle démarre immédiatement (le client recevra le Stade 1 après le délai configuré). Sinon, aucun mail n'est envoyé — le cycle repartira quand le client ajoutera un article.",
      confirmLabel: "Réinitialiser",
      type: "danger",
    });
    if (ok !== true) return;
    setRunning(true);
    const res = await resetAbandonedCartStagesForUser(userId);
    setRunning(false);
    if (!res.success) {
      toast.error("Réinitialisation impossible", res.error);
      return;
    }
    toast.success(
      "Stades réinitialisés",
      res.timerStarted
        ? "Le cycle redémarre au Stade 1 — le mail partira à l'échéance du délai configuré."
        : res.cartWasEmpty
          ? "Le panier est vide — le cycle repartira dès que le client ajoutera un article."
          : "Le cycle reste en attente (client non approuvé, opt-out ou aucun stade configuré).",
    );
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      title="Réinitialiser les stades de relance"
      aria-label={`Réinitialiser les stades de relance pour ${userLabel}`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300 disabled:opacity-40 transition-colors"
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
