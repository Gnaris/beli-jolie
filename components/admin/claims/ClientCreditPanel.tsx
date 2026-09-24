"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { grantCreditForClient } from "@/app/actions/admin/claims";

type RecentCredit = {
  id: string;
  amount: number;
  remainingAmount: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * Raccourci « attribuer un avoir » depuis la fiche service client admin.
 * Pré-remplit le montant proposé (typiquement le total remboursable estimé de
 * la demande) pour un flux « je clique, je confirme, l'avoir est en compte ».
 */
export default function ClientCreditPanel({
  clientId,
  clientName,
  claimReference,
  initialAvailable,
  initialRecent,
  suggestedAmount,
}: {
  clientId: string;
  clientName: string;
  claimReference: string;
  initialAvailable: number;
  initialRecent: RecentCredit[];
  /** Montant pré-rempli — typiquement `totalRefundable` calculé côté serveur. */
  suggestedAmount?: number;
}) {
  const [amount, setAmount] = useState<string>(
    suggestedAmount && suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "",
  );
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [available, setAvailable] = useState(initialAvailable);
  const [recent, setRecent] = useState(initialRecent);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  async function handleSubmit() {
    const num = Number(amount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("Montant invalide", "Saisissez un montant supérieur à 0.");
      return;
    }

    const finalReason =
      reason.trim() || `Geste commercial – demande ${claimReference}`;

    const ok = await confirm({
      title: "Accorder cet avoir ?",
      message: `${num.toFixed(2)} € seront ajoutés au solde crédit de ${clientName}. Motif : « ${finalReason} ».`,
      confirmLabel: "Accorder",
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await grantCreditForClient({
        userId: clientId,
        amount: num,
        reason: reason.trim() || undefined,
        expiresAt: expiresAt || null,
        claimReference,
      });
      if (!res.success) {
        toast.error("Attribution impossible", res.error);
        return;
      }
      toast.success(
        `Avoir de ${num.toFixed(2)} € accordé`,
        `Nouveau solde disponible : ${res.available.toFixed(2)} €`,
      );
      setAvailable(res.available);
      setRecent((prev) => [
        {
          id: res.creditId,
          amount: num,
          remainingAmount: num,
          reason: finalReason,
          expiresAt: expiresAt || null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 5));
      setAmount("");
      setReason("");
      setExpiresAt("");
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-primary overflow-hidden shadow-sm">
      <div className="px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
          <span
            className="w-[3px] h-[14px] rounded-[3px]"
            style={{ background: "linear-gradient(180deg, #10B981, #047857)" }}
          />
          Crédit / Avoir
        </span>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">Solde disponible</p>
          <p className="font-heading font-bold text-xl text-emerald-700 tabular-nums">
            {available.toFixed(2)} €
          </p>
        </div>
      </div>

      <div className="px-5 py-4 sm:px-6 sm:py-5 grid gap-3 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
        <div>
          <label htmlFor="credit-amount" className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
            Montant à accorder
          </label>
          <div className="relative">
            <input
              id="credit-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isPending}
              placeholder="0.00"
              className="w-full pl-3 pr-8 py-2.5 rounded-xl border border-border bg-white text-sm font-semibold tabular-nums focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:bg-zinc-50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">€</span>
          </div>
          {suggestedAmount && suggestedAmount > 0 && (
            <button
              type="button"
              onClick={() => setAmount(suggestedAmount.toFixed(2))}
              className="mt-1 text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline"
            >
              Pré-remplir avec le total remboursable ({suggestedAmount.toFixed(2)} €)
            </button>
          )}
        </div>

        <div>
          <label htmlFor="credit-reason" className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
            Motif (optionnel)
          </label>
          <input
            id="credit-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            placeholder={`Geste commercial – demande ${claimReference}`}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:bg-zinc-50"
          />
        </div>

        <div>
          <label htmlFor="credit-expires" className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
            Expire le (optionnel)
          </label>
          <input
            id="credit-expires"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={isPending}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:bg-zinc-50"
          />
        </div>

        <div className="sm:col-span-3 flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !amount.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Attribution…" : "Accorder l'avoir"}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted mb-2">
            Historique récent
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {recent.map((c) => {
              const used = c.amount - c.remainingAmount;
              const fullyUsed = c.remainingAmount <= 0.005;
              const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
              return (
                <li key={c.id} className="px-3 py-2.5 text-sm flex items-center gap-3 flex-wrap bg-white">
                  <span className={`font-bold tabular-nums ${fullyUsed || expired ? "text-text-muted line-through" : "text-emerald-700"}`}>
                    {c.amount.toFixed(2)} €
                  </span>
                  <span className="text-text-secondary text-xs flex-1 min-w-0 truncate">{c.reason ?? "—"}</span>
                  {used > 0.005 && !fullyUsed && (
                    <span className="text-[11px] text-amber-700">
                      restant : {c.remainingAmount.toFixed(2)} €
                    </span>
                  )}
                  {fullyUsed && <span className="text-[11px] text-text-muted">Consommé</span>}
                  {expired && <span className="text-[11px] text-red-600">Expiré</span>}
                  <span className="text-[11px] text-text-muted whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
