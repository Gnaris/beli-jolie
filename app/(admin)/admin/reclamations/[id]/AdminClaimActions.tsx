"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateClaimStatus,
  setClaimResolution,
  updateAdminNote,
} from "@/app/actions/admin/claims";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  claimId: string;
  status: string;
  adminNote: string | null;
}

export default function AdminClaimActions({ claimId, status, adminNote: initialNote }: Props) {
  const [message, setMessage] = useState("");
  const [resolutionType, setResolutionType] = useState<"NONE" | "REFUND" | "CREDIT" | "RESHIP">("NONE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(initialNote || "");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();

  function handleStatusChange(newStatus: string) {
    startTransition(async () => {
      const result = await updateClaimStatus(claimId, newStatus, message || undefined);
      if (result.success) {
        toast.success("Statut mis à jour");
        setMessage("");
        router.refresh();
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  function handleResolution() {
    startTransition(async () => {
      const result = await setClaimResolution(claimId, resolutionType, {
        amount: amount ? parseFloat(amount) : undefined,
        message: message || undefined,
      });
      if (result.success) {
        toast.success("Résolution appliquée");
        router.refresh();
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  function handleSaveNote() {
    startTransition(async () => {
      await updateAdminNote(claimId, note);
      toast.success("Note sauvegardée");
    });
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
      <h3 className="font-heading font-bold text-text-primary">Actions</h3>

      {/* OPEN → Examiner */}
      {status === "OPEN" && (
        <button onClick={() => handleStatusChange("IN_REVIEW")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors">
          Examiner
        </button>
      )}

      {/* IN_REVIEW → Accept / Reject */}
      {status === "IN_REVIEW" && (
        <div className="space-y-3">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message au client (optionnel)"
            rows={2} className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body resize-none" />
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange("ACCEPTED")} disabled={isPending}
              className="flex-1 px-3 py-2 text-sm font-body bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] disabled:opacity-40">
              Accepter
            </button>
            <button onClick={async () => { if (await confirm({ title: "Refuser", message: "Refuser cette réclamation ?" })) handleStatusChange("REJECTED"); }} disabled={isPending}
              className="flex-1 px-3 py-2 text-sm font-body bg-[#EF4444] text-white rounded-lg hover:bg-[#DC2626] disabled:opacity-40">
              Refuser
            </button>
          </div>
        </div>
      )}

      {/* ACCEPTED → Resolution + Return */}
      {status === "ACCEPTED" && (
        <div className="space-y-4">
          {/* Resolution */}
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Résolution</p>
            <div className="flex gap-1 flex-wrap">
              {(["NONE", "CREDIT", "REFUND", "RESHIP"] as const).map((r) => (
                <button key={r} onClick={() => setResolutionType(r)}
                  className={`px-3 py-1.5 text-xs font-body rounded-md ${resolutionType === r ? "bg-[#1A1A1A] text-white" : "bg-bg-secondary text-text-muted"}`}>
                  {r === "NONE" ? "Aucune" : r === "CREDIT" ? "Avoir" : r === "REFUND" ? "Remboursement" : "Réenvoi"}
                </button>
              ))}
            </div>
            {(resolutionType === "CREDIT" || resolutionType === "REFUND") && (
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="Montant EUR" className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
            )}
            <button onClick={handleResolution} disabled={isPending}
              className="w-full px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40">
              Appliquer la résolution
            </button>
          </div>

        </div>
      )}

      {/* RESOLUTION_PENDING → Resolve */}
      {status === "RESOLUTION_PENDING" && (
        <button onClick={() => handleStatusChange("RESOLVED")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] disabled:opacity-40">
          Marquer comme résolue
        </button>
      )}

      {/* RESOLVED / REJECTED → Close */}
      {(status === "RESOLVED" || status === "REJECTED") && (
        <button onClick={() => handleStatusChange("CLOSED")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border disabled:opacity-40">
          Clôturer
        </button>
      )}

      {/* CLOSED → Reopen */}
      {status === "CLOSED" && (
        <button onClick={() => handleStatusChange("OPEN")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors">
          Rouvrir la réclamation
        </button>
      )}

      {/* Admin note */}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Note interne</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note privée..."
          className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body resize-none" />
        <button onClick={handleSaveNote} disabled={isPending}
          className="px-3 py-1.5 text-xs font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border">
          Sauvegarder
        </button>
      </div>
    </div>
  );
}
