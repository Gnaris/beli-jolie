"use client";

/**
 * Bouton « Auditer PFS » dans l'en-tête de la page produits.
 *
 * Rôle : lancer un audit en tâche de fond, puis ouvrir le tiroir « Audit PFS »
 * du widget flottant unique en bas à droite. TOUT le rendu de progression et
 * de résultats vit dans `components/admin/widgets-rail/PfsAuditDrawer.tsx` —
 * ce bouton ne fait que le trigger.
 *
 * L'état RUNNING/DONE est lu directement dans le drawer (polling), qui alimente
 * le badge du rail. Ici on se limite à désactiver le bouton pendant qu'un audit
 * tourne pour éviter de démarrer deux audits en concurrence.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  startPfsAuditAction,
  getPfsAuditStateAction,
} from "@/app/actions/admin/pfs-audit";
import { useRightRail } from "@/components/admin/widgets-rail";

interface Props {
  hasPfsConfig: boolean;
}

export default function PfsAuditButton({ hasPfsConfig }: Props) {
  const toast = useToast();
  const { open } = useRightRail();
  const [status, setStatus] = useState<"IDLE" | "RUNNING" | "DONE" | "ERROR" | "STOPPED" | null>(null);
  const [starting, setStarting] = useState(false);

  // Poll toutes les 5 s pour reflèter le RUNNING venant d'une autre session/onglet.
  useEffect(() => {
    if (!hasPfsConfig) return;
    let alive = true;
    const load = async () => {
      const r = await getPfsAuditStateAction();
      if (alive && r.success) setStatus(r.state.status);
    };
    void load();
    const id = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [hasPfsConfig]);

  const start = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const r = await startPfsAuditAction();
      if (!r.success) {
        toast.error("Impossible de lancer l'audit", r.error);
        return;
      }
      setStatus(r.state.status);
      // Ouvre directement le tiroir « Audit PFS » du widget flottant pour que
      // la cliente voie la progression tout de suite.
      open("pfs-audit");
      toast.info(
        "Audit PFS lancé",
        "Suivez la progression dans la fenêtre en bas à droite.",
      );
    } finally {
      setStarting(false);
    }
  }, [starting, toast, open]);

  if (!hasPfsConfig) return null;

  const isRunning = status === "RUNNING";

  return (
    <button
      type="button"
      onClick={() => (isRunning ? open("pfs-audit") : void start())}
      disabled={starting}
      className={`inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-body font-medium transition-all w-full md:w-auto bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 ${starting ? "opacity-70 cursor-wait" : ""}`}
      title={
        isRunning
          ? "Un audit est en cours — cliquer pour voir la progression"
          : "Vérifie tous les produits liés à PFS et liste les écarts"
      }
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <span>{isRunning ? "Voir l'audit en cours" : "Auditer PFS"}</span>
    </button>
  );
}
