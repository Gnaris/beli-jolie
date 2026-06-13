"use client";

import { useEffect, useRef, useState } from "react";
import MarketplaceMappingBadge from "@/components/admin/MarketplaceMappingBadge";

/**
 * Champ inline pour saisir un mapping Faire (taxonomy_type.id, code SH ou
 * libellé matière). Affiche un badge cliquable ; au clic, devient un input
 * texte avec autofocus. Enter/Blur sauvegarde, Échap annule.
 *
 * La taxonomie Faire est figée et non exposée via API publique (voir
 * docs/faire-api.md §12) — c'est pourquoi on est en saisie manuelle. La
 * cliente trouve les IDs dans son portail brand Faire.
 */
export default function FaireMappingInput({
  value,
  onSave,
  placeholder,
  label,
  inputWidthClass = "w-44",
  helpText,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  placeholder: string;
  label?: string;
  inputWidthClass?: string;
  helpText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Sync draft when external value changes (e.g. after router.refresh())
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    const trimmed = draft.trim();
    const next: string | null = trimmed.length > 0 ? trimmed : null;
    if (next === (value ?? null)) {
      setEditing(false);
      setErrorMsg(null);
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value ?? "");
    setErrorMsg(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="space-y-0.5">
        {label && (
          <p className="font-body text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={helpText ?? "Cliquez pour modifier"}
          className="inline-flex items-center gap-1 rounded-md hover:opacity-80 transition-opacity"
        >
          <MarketplaceMappingBadge value={value} title={value ?? undefined} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {label && (
        <p className="font-body text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => void commit()}
          placeholder={placeholder}
          disabled={saving}
          className={`${inputWidthClass} h-7 px-2 rounded-md border border-border bg-bg-primary text-text-primary text-xs font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 disabled:opacity-50`}
        />
      </div>
      {errorMsg && (
        <p className="font-body text-[10px] text-[#EF4444]">{errorMsg}</p>
      )}
    </div>
  );
}
