"use client";

import { useEffect, useState } from "react";
import { createHsCode, updateHsCode } from "@/app/actions/admin/hs-codes";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (saved: { id: string; code: string; label: string }) => void;
  editMode?: { id: string; code: string; label: string } | null;
}

export default function HsCodeModal({ open, onClose, onSaved, editMode = null }: Props) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(editMode?.code ?? "");
      setLabel(editMode?.label ?? "");
      setError("");
    }
  }, [open, editMode]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (editMode) {
        await updateHsCode(editMode.id, { code, label });
        onSaved({
          id: editMode.id,
          code: code.trim(),
          label: label.trim(),
        });
      } else {
        const result = await createHsCode({ code, label });
        onSaved({
          id: result.id,
          code: result.code,
          label: result.label,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold font-heading text-text-primary mb-4">
          {editMode ? "Modifier le code SH" : "Nouveau code SH"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-body text-text-secondary mb-1">
              Numéro
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="ex : 7117190000"
              className="field-input w-full font-mono"
              maxLength={10}
              autoFocus
            />
            <p className="text-[11px] text-text-muted font-body mt-1">
              6 à 10 chiffres.
            </p>
          </div>
          <div>
            <label className="block text-sm font-body text-text-secondary mb-1">
              Libellé
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex : Bijouterie fantaisie en métaux communs"
              className="field-input w-full"
              maxLength={200}
            />
          </div>
          {error && (
            <p className="text-xs text-[#EF4444] font-body">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={saving}
            >
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Enregistrement…" : editMode ? "Enregistrer" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
