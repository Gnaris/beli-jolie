"use client";

import { useState, useTransition } from "react";
import {
  submitCustomerReview,
  updateMyCustomerReview,
  deleteMyCustomerReview,
} from "@/app/actions/client/customer-reviews";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { REVIEW_TEXT_MAX, REVIEW_TEXT_MIN } from "@/lib/customer-reviews-constants";

export interface MyReviewInitial {
  id: string;
  rating: number;
  text: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  moderatedAt: string | null;
  moderationNote: string | null;
}

interface Props {
  hasEligibleOrder: boolean;
  initialReview: MyReviewInitial | null;
}

const STATUS_LABEL: Record<MyReviewInitial["status"], string> = {
  PENDING: "En attente de validation",
  APPROVED: "Publié sur la boutique",
  REJECTED: "Non publié",
};

const STATUS_STYLE: Record<
  MyReviewInitial["status"],
  { bg: string; text: string; dot: string }
> = {
  PENDING: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
  APPROVED: { bg: "bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-500" },
  REJECTED: { bg: "bg-rose-50", text: "text-rose-800", dot: "bg-rose-500" },
};

export default function MyReviewCard({ hasEligibleOrder, initialReview }: Props) {
  const [review, setReview] = useState<MyReviewInitial | null>(initialReview);
  const [editing, setEditing] = useState(!initialReview && hasEligibleOrder);
  const [rating, setRating] = useState<number>(initialReview?.rating ?? 5);
  const [text, setText] = useState<string>(initialReview?.text ?? "");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const confirm = useConfirm();

  const canEdit = review?.status === "PENDING";
  const isFrozen = review && review.status !== "PENDING";
  const canSave = text.trim().length >= REVIEW_TEXT_MIN && rating >= 1 && rating <= 5;

  function resetForm(from: MyReviewInitial | null) {
    setRating(from?.rating ?? 5);
    setText(from?.text ?? "");
  }

  function handleSave() {
    if (!canSave) return;
    startTransition(async () => {
      const result = review
        ? await updateMyCustomerReview({ rating, text })
        : await submitCustomerReview({ rating, text });
      if (result.success) {
        toast({
          type: "success",
          title: review ? "Avis modifié" : "Avis envoyé",
          message: "Notre équipe va le valider avant publication.",
        });
        // Simuler la mise à jour locale (on ne re-fetche pas — le tag est
        // révalidé serveur pour les prochaines pages).
        setReview({
          id: review?.id ?? "temp",
          rating,
          text,
          status: "PENDING",
          createdAt: review?.createdAt ?? new Date().toISOString(),
          moderatedAt: null,
          moderationNote: null,
        });
        setEditing(false);
      } else {
        toast({ type: "error", title: "Erreur", message: result.error ?? "Erreur" });
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer votre avis ?",
      message: "Cette action est définitive.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteMyCustomerReview();
      if (result.success) {
        toast({ type: "success", title: "Avis supprimé", message: "" });
        setReview(null);
        setEditing(hasEligibleOrder);
        resetForm(null);
      } else {
        toast({ type: "error", title: "Erreur", message: result.error ?? "Erreur" });
      }
    });
  }

  return (
    <section className="bg-bg-primary rounded-2xl border border-border p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted font-body font-medium">
            Votre avis
          </p>
          <h2 className="font-heading text-lg font-semibold text-text-primary mt-1">
            Déposer un avis
          </h2>
        </div>
        {review && (
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[review.status].bg} ${STATUS_STYLE[review.status].text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[review.status].dot}`} />
            {STATUS_LABEL[review.status]}
          </span>
        )}
      </div>

      {/* Cas 1 : pas de commande éligible → placeholder */}
      {!hasEligibleOrder && !review && (
        <p className="text-sm text-text-secondary font-body leading-relaxed">
          Vous pourrez laisser un avis dès que votre première commande aura été
          expédiée. Merci pour votre confiance !
        </p>
      )}

      {/* Cas 2 : avis existant, mode consultation */}
      {review && !editing && (
        <>
          <div className="flex gap-1 mb-3">
            {Array.from({ length: 5 }, (_, i) => (
              <StarIcon key={i} filled={i < review.rating} />
            ))}
          </div>
          <p className="text-sm text-text-primary font-body leading-relaxed whitespace-pre-line">
            {review.text}
          </p>

          {review.status === "REJECTED" && review.moderationNote && (
            <div className="mt-4 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-xs text-rose-800 font-body">
              <p className="font-semibold mb-1">Motif du refus</p>
              <p>{review.moderationNote}</p>
            </div>
          )}

          {isFrozen && (
            <p className="text-xs text-text-muted font-body mt-4">
              Votre avis a été modéré ; pour toute demande de modification,
              contactez notre équipe.
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap gap-3 mt-5">
              <button
                type="button"
                onClick={() => {
                  resetForm(review);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition"
              >
                Modifier
              </button>
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
        </>
      )}

      {/* Cas 3 : formulaire (création ou édition) */}
      {editing && hasEligibleOrder && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-body font-medium text-text-primary mb-2">
              Votre note
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="p-1"
                  aria-label={`${star} étoile${star > 1 ? "s" : ""}`}
                >
                  <StarIcon filled={star <= rating} large />
                </button>
              ))}
              <span className="ml-2 text-sm text-text-muted font-body tabular-nums">
                {rating} / 5
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="my-review-text" className="block text-sm font-body font-medium text-text-primary mb-1.5">
              Votre témoignage
            </label>
            <textarea
              id="my-review-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, REVIEW_TEXT_MAX))}
              rows={5}
              placeholder="Racontez votre expérience en quelques phrases…"
              className="field-input resize-y min-h-[120px]"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[11px] text-text-muted font-body">
                Minimum {REVIEW_TEXT_MIN} caractères.
              </p>
              <p className="text-[11px] text-text-muted font-body tabular-nums">
                {text.length} / {REVIEW_TEXT_MAX}
              </p>
            </div>
          </div>

          <p className="text-xs text-text-muted font-body">
            Votre avis sera vérifié par notre équipe avant d&apos;être publié
            sur la page d&apos;accueil. Nom affiché : votre prénom + initiale.
          </p>

          <div className="flex flex-wrap gap-3 justify-end">
            {review && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  resetForm(review);
                }}
                disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition disabled:opacity-50"
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || pending}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-bg-dark text-white text-sm font-heading font-semibold hover:bg-bg-darker transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Envoi…" : review ? "Enregistrer les modifications" : "Envoyer mon avis"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StarIcon({ filled, large = false }: { filled: boolean; large?: boolean }) {
  const size = large ? 26 : 18;
  return (
    <svg
      width={size}
      height={size}
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
