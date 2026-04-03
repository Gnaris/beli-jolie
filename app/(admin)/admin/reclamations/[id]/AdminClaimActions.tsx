"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClaimStatus, setClaimResolution, requestReturn, confirmReturnReceived, updateAdminNote } from "@/app/actions/admin/claims";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  claimId: string;
  status: string;
  userId: string;
  adminNote: string | null;
}

export default function AdminClaimActions({ claimId, status, userId, adminNote: initialNote }: Props) {
  const [message, setMessage] = useState("");
  const [resolutionType, setResolutionType] = useState<"REFUND" | "CREDIT" | "RESHIP">("CREDIT");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(initialNote || "");
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  function handleStatusChange(newStatus: string) {
    startTransition(async () => {
      const result = await updateClaimStatus(claimId, newStatus, message || undefined);
      if (result.success) {
        addToast("Statut mis a jour", "success");
        setMessage("");
        router.refresh();
      } else {
        addToast(result.error || "Erreur", "error");
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
        addToast("Resolution appliquee", "success");
        router.refresh();
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  function handleRequestReturn(method: "EASY_EXPRESS" | "CLIENT_SELF") {
    startTransition(async () => {
      const result = await requestReturn(claimId, method);
      if (result.success) {
        addToast("Retour demande", "success");
        router.refresh();
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  function handleConfirmReceived() {
    startTransition(async () => {
      const result = await confirmReturnReceived(claimId);
      if (result.success) {
        addToast("Retour recu confirme", "success");
        router.refresh();
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  function handleSaveNote() {
    startTransition(async () => {
      await updateAdminNote(claimId, note);
      addToast("Note sauvegardee", "success");
    });
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
      <h3 className="font-heading font-bold text-text-primary">Actions</h3>

      {/* Status-specific actions */}
      {status === "OPEN" && (
        <button onClick={() => handleStatusChange("IN_REVIEW")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40 transition-colors">
          Examiner
        </button>
      )}

      {status === "IN_REVIEW" && (
        <div className="space-y-3">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message au client (optionnel)"
            rows={2} className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body resize-none" />
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange("ACCEPTED")} disabled={isPending}
              className="flex-1 px-3 py-2 text-sm font-body bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] disabled:opacity-40">
              Accepter
            </button>
            <button onClick={async () => { if (await confirm("Refuser cette reclamation ?")) handleStatusChange("REJECTED"); }} disabled={isPending}
              className="flex-1 px-3 py-2 text-sm font-body bg-[#EF4444] text-white rounded-lg hover:bg-[#DC2626] disabled:opacity-40">
              Refuser
            </button>
          </div>
        </div>
      )}

      {status === "ACCEPTED" && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Resolution</p>
          <div className="flex gap-1">
            {(["CREDIT", "REFUND", "RESHIP"] as const).map((r) => (
              <button key={r} onClick={() => setResolutionType(r)}
                className={`px-3 py-1.5 text-xs font-body rounded-md ${resolutionType === r ? "bg-[#1A1A1A] text-white" : "bg-bg-secondary text-text-muted"}`}>
                {r === "CREDIT" ? "Avoir" : r === "REFUND" ? "Remboursement" : "Reenvoi"}
              </button>
            ))}
          </div>
          {(resolutionType === "CREDIT" || resolutionType === "REFUND") && (
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="Montant EUR" className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
          )}
          <button onClick={handleResolution} disabled={isPending}
            className="w-full px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] disabled:opacity-40">
            Appliquer la resolution
          </button>

          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Retour produit</p>
            <div className="flex gap-2">
              <button onClick={() => handleRequestReturn("EASY_EXPRESS")} disabled={isPending}
                className="flex-1 px-3 py-2 text-xs font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border">
                Easy Express
              </button>
              <button onClick={() => handleRequestReturn("CLIENT_SELF")} disabled={isPending}
                className="flex-1 px-3 py-2 text-xs font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border">
                Envoi client
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "RETURN_SHIPPED" && (
        <button onClick={handleConfirmReceived} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] disabled:opacity-40">
          Confirmer reception du retour
        </button>
      )}

      {(status === "RETURN_RECEIVED" || status === "RESOLUTION_PENDING") && (
        <button onClick={() => handleStatusChange("RESOLVED")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-[#22C55E] text-white rounded-lg hover:bg-[#16A34A] disabled:opacity-40">
          Marquer comme resolue
        </button>
      )}

      {(status === "RESOLVED" || status === "REJECTED") && (
        <button onClick={() => handleStatusChange("CLOSED")} disabled={isPending}
          className="w-full px-4 py-2 text-sm font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border disabled:opacity-40">
          Cloturer
        </button>
      )}

      {/* Admin note */}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Note interne</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note privee..."
          className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body resize-none" />
        <button onClick={handleSaveNote} disabled={isPending}
          className="px-3 py-1.5 text-xs font-body bg-bg-secondary text-text-primary rounded-lg hover:bg-border">
          Sauvegarder
        </button>
      </div>
    </div>
  );
}
