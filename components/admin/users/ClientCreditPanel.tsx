"use client";

import { useMemo, useState, useTransition } from "react";
import { addClientCredit, revokeClientCredit } from "@/app/actions/admin/client-credit";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export interface ClientCreditEntry {
  id: string;
  amount: number;
  remainingAmount: number;
  expiresAt: string | null;
  createdAt: string;
  usagesCount: number;
  reason: string | null;
}

interface Props {
  userId: string;
  credits: ClientCreditEntry[];
}

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Fiche client — bloc de gestion du crédit (avoir). L'admin peut créditer
 * un montant en €, avec expiration optionnelle. Solde = somme des
 * remainingAmount encore actifs (non expirés).
 */
export default function ClientCreditPanel({ userId, credits }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");

  const now = Date.now();
  const availableCredit = useMemo(
    () =>
      credits.reduce((sum, c) => {
        if (c.expiresAt && new Date(c.expiresAt).getTime() < now) return sum;
        return sum + c.remainingAmount;
      }, 0),
    [credits, now],
  );

  function handleAdd() {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Saisis un montant supérieur à 0");
      return;
    }
    startTransition(async () => {
      const res = await addClientCredit(userId, {
        amount: value,
        expiresAt: expiresAt || null,
        reason: reason.trim() || null,
      });
      if (res.success) {
        toast.success(`Crédit de ${value.toFixed(2)} € ajouté`);
        setAmount("");
        setExpiresAt("");
        setReason("");
      } else {
        toast.error(res.error);
      }
    });
  }

  async function handleRevoke(credit: ClientCreditEntry) {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce crédit ?",
      message: `Le crédit de ${credit.amount.toFixed(2)} € sera annulé. Cette action ne peut pas être annulée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await revokeClientCredit(credit.id);
      if (res.success) toast.success("Crédit supprimé");
      else toast.error(res.error);
    });
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-text-primary">
            Crédit / Avoir
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Somme utilisable par la cliente lors de son prochain paiement.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1">
            Solde disponible
          </p>
          <p className="font-heading text-2xl font-bold text-emerald-700 tabular-nums">
            {availableCredit.toFixed(2)} €
          </p>
        </div>
      </div>

      {/* Formulaire ajout */}
      <div className="rounded-xl bg-bg-tertiary border border-border p-4 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          Ajouter un crédit
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Montant (€)</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex : 30"
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Expire le (optionnel)
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">
            Motif (optionnel — visible en interne)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Ex : Geste commercial suite retard livraison, remboursement colis abîmé, fidélité…"
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary resize-y"
          />
          <p className="text-[10px] text-text-muted mt-1 text-right">{reason.length} / 500</p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !amount}
            className="btn-primary h-[38px] px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isPending ? "…" : "Créditer"}
          </button>
        </div>
      </div>

      {/* Historique */}
      {credits.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">
            Historique ({credits.length})
          </p>
          <div className="divide-y divide-border-light border border-border rounded-xl overflow-hidden">
            {credits.map((credit) => {
              const isExpired =
                credit.expiresAt && new Date(credit.expiresAt).getTime() < now;
              const isUsedUp = credit.remainingAmount <= 0;
              const canRevoke = !isUsedUp && credit.usagesCount === 0;
              return (
                <div
                  key={credit.id}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary tabular-nums">
                      {credit.amount.toFixed(2)} € accordé
                      {credit.remainingAmount < credit.amount && (
                        <span className="text-text-muted font-normal">
                          {" "}
                          · reste {credit.remainingAmount.toFixed(2)} €
                        </span>
                      )}
                    </p>
                    {credit.reason && (
                      <p className="text-xs text-text-primary mt-1 whitespace-pre-wrap break-words">
                        « {credit.reason} »
                      </p>
                    )}
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Le {dateFormatter.format(new Date(credit.createdAt))}
                      {credit.expiresAt && (
                        <>
                          {" "}· expire le{" "}
                          {dateFormatter.format(new Date(credit.expiresAt))}
                        </>
                      )}
                      {credit.usagesCount > 0 && (
                        <>
                          {" "}· utilisé sur {credit.usagesCount} commande
                          {credit.usagesCount > 1 ? "s" : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isExpired ? (
                      <span className="badge badge-neutral text-[11px]">Expiré</span>
                    ) : isUsedUp ? (
                      <span className="badge badge-neutral text-[11px]">Utilisé</span>
                    ) : (
                      <span className="badge badge-success text-[11px]">Actif</span>
                    )}
                    {canRevoke && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(credit)}
                        disabled={isPending}
                        className="text-[11px] text-rose-700 hover:text-rose-900 underline underline-offset-2 disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
