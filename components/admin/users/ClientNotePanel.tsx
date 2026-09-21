"use client";

import { useState, useTransition } from "react";
import { setUserAdminNote } from "@/app/actions/admin/setUserAdminNote";
import { useToast } from "@/components/ui/Toast";

interface Props {
  userId: string;
  initialNote: string;
}

/**
 * Note interne libre sur la fiche client — textarea + bouton Enregistrer.
 * Reproduit le pattern de ProductNoteBar (fiche produit) pour rester cohérent.
 */
export default function ClientNotePanel({ userId, initialNote }: Props) {
  const [note, setNote] = useState<string>(initialNote);
  const [savedNote, setSavedNote] = useState<string>(initialNote);
  const [isPending, startTransition] = useTransition();
  const { success, error } = useToast();

  const isDirty = note !== savedNote;

  const handleSave = () => {
    startTransition(async () => {
      const res = await setUserAdminNote(userId, note);
      if (res.success) {
        setSavedNote(note);
        success("Note enregistrée");
      } else {
        error("Impossible d'enregistrer la note", res.error);
      }
    });
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-text-primary">
            Note interne
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Visible uniquement en interne — le client ne verra jamais ce texte.
          </p>
        </div>
        {isDirty && (
          <span className="text-[11px] text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
            Modifications non enregistrées
          </span>
        )}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={10}
        placeholder="Ex : « Rappeler jeudi pour valider sa commande », « préfère être livrée avant 10h », « demande toujours une facture papier »…"
        className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted">{note.length} / 2000</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !isDirty}
          className="btn-primary h-10 px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer la note"}
        </button>
      </div>
    </div>
  );
}
