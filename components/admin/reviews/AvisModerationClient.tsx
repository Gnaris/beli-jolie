"use client";

import { useState, useTransition } from "react";
import {
  approveCustomerReview,
  rejectCustomerReview,
  deleteCustomerReview,
  type AdminReviewRow,
} from "@/app/actions/admin/customer-reviews";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  pending: AdminReviewRow[];
  moderated: AdminReviewRow[];
}

const STATUS_LABEL: Record<AdminReviewRow["status"], string> = {
  PENDING: "En attente",
  APPROVED: "Publié",
  REJECTED: "Refusé",
};

const STATUS_STYLE: Record<
  AdminReviewRow["status"],
  { bg: string; text: string; dot: string }
> = {
  PENDING: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
  APPROVED: { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500" },
  REJECTED: { bg: "bg-rose-50", text: "text-rose-800", dot: "bg-rose-500" },
};

export default function AvisModerationClient({ pending, moderated }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-3 mb-4 px-1">
          <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-800" />
          <h2 className="text-[11px] font-body font-bold uppercase tracking-[0.18em] text-amber-700">
            À modérer · {pending.length}
          </h2>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-bg-secondary p-10 text-center">
            <p className="text-sm text-text-muted font-body">
              Aucun avis en attente. Vous serez notifiée par mail dès qu&apos;un
              client en dépose un nouveau.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {pending.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-3 mb-4 px-1 group"
        >
          <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-slate-400 to-slate-700" />
          <h2 className="text-[11px] font-body font-bold uppercase tracking-[0.18em] text-slate-700 group-hover:text-text-primary transition">
            Historique · {moderated.length}
          </h2>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`text-text-muted transition-transform ${showHistory ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showHistory && (
          moderated.length === 0 ? (
            <p className="text-sm text-text-muted font-body px-1">
              Aucun avis modéré pour le moment.
            </p>
          ) : (
            <div className="grid gap-4">
              {moderated.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
}

function ReviewCard({ review }: { review: AdminReviewRow }) {
  const [pending, startTransition] = useTransition();
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState(review.moderationNote ?? "");
  const { toast } = useToast();
  const confirm = useConfirm();
  const style = STATUS_STYLE[review.status];

  function handleApprove() {
    startTransition(async () => {
      const result = await approveCustomerReview(review.id);
      if (result.success) {
        toast({ type: "success", title: "Avis publié", message: `${review.displayName} apparaît maintenant sur la page d'accueil.` });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error ?? "Erreur" });
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectCustomerReview(review.id, rejectNote);
      if (result.success) {
        toast({ type: "success", title: "Avis refusé", message: "Il n'apparaîtra pas sur la page d'accueil." });
        setRejectMode(false);
      } else {
        toast({ type: "error", title: "Erreur", message: result.error ?? "Erreur" });
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer définitivement cet avis ?",
      message: "L'avis sera retiré de la base et le client pourra en poster un nouveau.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteCustomerReview(review.id);
      if (result.success) {
        toast({ type: "success", title: "Avis supprimé", message: "" });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error ?? "Erreur" });
      }
    });
  }

  return (
    <article className="rounded-2xl border border-border bg-bg-primary p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-heading font-semibold text-text-primary">
            {review.user.fullName || review.user.email}
          </p>
          <p className="text-xs text-text-muted font-body mt-0.5">
            {review.user.company ? `${review.user.company} · ` : ""}
            {review.user.email}
          </p>
          <p className="text-xs text-text-muted font-body mt-0.5">
            Affichage public : <span className="text-text-secondary font-semibold">{review.displayName}</span>
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {STATUS_LABEL[review.status]}
        </span>
      </header>

      <div className="flex gap-1 mb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <StarIcon key={i} filled={i < review.rating} />
        ))}
        <span className="ml-2 text-xs text-text-muted font-body tabular-nums">
          {review.rating} / 5
        </span>
      </div>

      <p className="text-sm text-text-primary font-body leading-relaxed whitespace-pre-line">
        {review.text}
      </p>

      <p className="text-[11px] text-text-muted font-body mt-4">
        Déposé le {new Date(review.createdAt).toLocaleString("fr-FR")}
        {review.moderatedAt && ` · Modéré le ${new Date(review.moderatedAt).toLocaleString("fr-FR")}`}
      </p>

      {review.moderationNote && review.status === "REJECTED" && (
        <div className="mt-3 rounded-xl bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-800 font-body">
          <p className="font-semibold mb-0.5">Motif de refus</p>
          <p>{review.moderationNote}</p>
        </div>
      )}

      {review.status === "PENDING" && !rejectMode && (
        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={() => setRejectMode(true)}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-body font-medium text-rose-700 hover:bg-rose-50 hover:border-rose-200 transition disabled:opacity-50"
          >
            Refuser
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={pending}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-600 text-white text-sm font-heading font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
          >
            Approuver
          </button>
        </div>
      )}

      {rejectMode && (
        <div className="mt-5 space-y-3">
          <label className="block text-sm font-body font-medium text-text-primary">
            Motif du refus (interne)
          </label>
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value.slice(0, 400))}
            rows={2}
            placeholder="Ex : contenu hors sujet, propos inappropriés…"
            className="field-input"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectMode(false)}
              disabled={pending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={pending}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-rose-600 text-white text-sm font-heading font-semibold hover:bg-rose-700 transition disabled:opacity-50"
            >
              Confirmer le refus
            </button>
          </div>
        </div>
      )}

      {review.status !== "PENDING" && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-body font-medium text-rose-700 hover:bg-rose-50 transition disabled:opacity-50"
          >
            Supprimer
          </button>
        </div>
      )}
    </article>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "#f59e0b" : "none"}
      stroke={filled ? "#f59e0b" : "#94a3b8"}
      strokeWidth={1.5}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12 3 2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 18l-5.8 3.2 1.1-6.6L2.5 9.9 9.1 9z"
      />
    </svg>
  );
}
