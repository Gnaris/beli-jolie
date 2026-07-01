"use client";

import { useState, useTransition } from "react";
import { updateProductNoteOnly } from "@/app/actions/admin/products";
import { useToast } from "@/components/ui/Toast";

interface Props {
  productId: string;
  initialNote: string;
}

export default function ProductNoteBar({ productId, initialNote }: Props) {
  const [note, setNote] = useState<string>(initialNote);
  const [savedNote, setSavedNote] = useState<string>(initialNote);
  const [isPending, startTransition] = useTransition();
  const { success, error } = useToast();

  const isDirty = note !== savedNote;

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateProductNoteOnly(productId, note);
      if (res.success) {
        setSavedNote(note);
        success("Note enregistrée");
      } else {
        error("Impossible d'enregistrer la note", res.error);
      }
    });
  };

  return (
    <div className="max-w-[1600px] mx-auto mt-8">
      <div className="rounded-2xl border border-border bg-bg-secondary p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📝</span>
            <h3 className="font-heading text-base font-semibold">Note interne</h3>
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
          rows={4}
          placeholder="Ex : « Complété par l'IA le 30/06/2026 » ou tout autre rappel interne."
          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-tertiary">{note.length} / 2000</span>
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
    </div>
  );
}
