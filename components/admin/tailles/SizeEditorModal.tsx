"use client";

/**
 * SizeEditorModal — modale unique pour créer une taille ou renommer
 * une taille existante. Reprend le langage visuel des modales couleurs /
 * catégories (header en cartouche, corps avec sections, footer avec CTA).
 *
 * En création : le nom + la référence PFS sont obligatoires.
 * En renommage : seul le nom est modifiable (la ref PFS se change via
 * SizeMappingModal, qui gère les suggestions).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";

interface PfsSizeOption {
  reference: string;
  label: string;
}

type CreateProps = {
  mode: "create";
  pfsOptions: PfsSizeOption[];
  pfsEnabled: boolean;
  onCreate: (name: string, pfsRef: string) => Promise<void>;
  onClose: () => void;
};

type RenameProps = {
  mode: "rename";
  currentName: string;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
};

type Props = CreateProps | RenameProps;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export default function SizeEditorModal(props: Props) {
  const toast = useToast();
  const backdrop = useBackdropClose(props.onClose);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(props.mode === "rename" ? props.currentName : "");
  const [pfsRef, setPfsRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const pfsSuggestions = useMemo(() => {
    if (props.mode !== "create") return [];
    if (!name) return [];
    const norm = normalize(name);
    return props.pfsOptions
      .filter((o) => {
        const refN = normalize(o.reference);
        const labelN = normalize(o.label);
        return refN === norm || labelN === norm || refN.includes(norm) || labelN.includes(norm);
      })
      .slice(0, 3);
  }, [props, name]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom est requis.");
      return;
    }
    if (props.mode === "create") {
      if (!pfsRef) {
        setError("La référence Paris Fashion Shop est obligatoire.");
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      try {
        if (props.mode === "create") {
          await props.onCreate(trimmed, pfsRef);
        } else {
          await props.onRename(trimmed);
        }
        props.onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur";
        setError(message);
        toast.error("Erreur", message);
      }
    });
  }

  if (!mounted) return null;

  const title = props.mode === "create" ? "Nouvelle taille" : "Renommer la taille";
  const cta = props.mode === "create" ? "Créer" : "Enregistrer";
  const pfsOptions = props.mode === "create"
    ? props.pfsOptions.map((o) => ({ value: o.reference, label: o.label }))
    : [];
  const pfsEnabled = props.mode === "create" ? props.pfsEnabled : false;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] flex flex-col max-h-[90vh] w-full max-w-[560px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden rounded-t-2xl border-b border-border bg-gradient-to-br from-slate-50 to-bg-primary px-6 py-4">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl bg-slate-200/60 pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary font-heading">
                {props.mode === "create" ? "Bibliothèque" : "Édition"}
              </div>
              <h3 className="font-heading text-base font-bold text-text-primary mt-1">
                {title}
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="text-text-muted hover:text-text-primary transition-colors rounded-lg p-1"
              aria-label="Fermer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary font-body mb-1.5">
              Nom <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="ex : M, 42, T38, Taille unique"
              className="field-input w-full text-sm"
            />
          </div>

          {props.mode === "create" && (
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary font-body mb-1.5">
                Référence Paris Fashion Shop <span className="text-[#EF4444]">*</span>
              </label>
              {pfsSuggestions.length > 0 && !pfsRef && (
                <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider font-body font-semibold text-emerald-700 mb-1.5">
                    Suggestions détectées
                  </p>
                  <div className="flex flex-col gap-1">
                    {pfsSuggestions.map((s) => (
                      <button
                        key={s.reference}
                        type="button"
                        onClick={() => setPfsRef(s.reference)}
                        className="text-left flex items-center justify-between gap-2 px-2 py-1 rounded text-xs font-body bg-bg-primary hover:bg-emerald-100 border border-emerald-200 transition-colors"
                      >
                        <span className="truncate text-text-primary">{s.label}</span>
                        <span className="shrink-0 text-[10px] text-emerald-700">{s.reference}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <CustomSelect
                value={pfsRef}
                onChange={(v) => setPfsRef(v)}
                options={pfsOptions}
                placeholder="Choisir une référence…"
                emptyMessage="Aucune référence trouvée"
                searchable
                disabled={!pfsEnabled}
              />
              {!pfsEnabled && (
                <p className="mt-1 text-[11px] text-text-muted font-body">
                  Référence Paris Fashion Shop indisponible pour l'instant.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-[#DC2626] font-body" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-bg-secondary/30 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="h-9 px-4 rounded-lg border border-border text-sm font-body text-text-secondary hover:bg-bg-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim() || (props.mode === "create" && !pfsRef)}
            className="h-9 px-4 rounded-lg bg-ink text-text-inverse text-sm font-body font-semibold shadow-[var(--shadow-sm)] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? "…" : cta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
