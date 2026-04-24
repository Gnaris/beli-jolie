"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/ui/CustomSelect";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import { createSize } from "@/app/actions/admin/sizes";
import PfsSuggestions from "@/components/admin/pfs/PfsSuggestions";

export interface QuickCreateSizeModalResult {
  id: string;
  name: string;
  pfsSizeRef: string;
}

interface QuickCreateSizeModalProps {
  open: boolean;
  onClose: () => void;
  /** PFS size refs available from annexes. Empty = PFS unavailable. */
  pfsSizes: { reference: string; label: string }[];
  /** Called after successful creation — caller receives the new size and should
   *  add it to availableSizes + auto-select it in the current variant. */
  onCreated: (size: QuickCreateSizeModalResult) => void;
  /** Nom pré-rempli (ex: taille PFS déjà connue lors de l'import). */
  defaultName?: string;
  /** Référence PFS pré-remplie — utilisée lors de l'import PFS. */
  defaultPfsRef?: string;
  /** Quand vrai, la référence PFS est affichée en lecture seule et le bloc
   *  "PFS indisponible" est masqué (on a déjà la valeur). */
  lockPfsRef?: boolean;
}

export default function QuickCreateSizeModal({
  open,
  onClose,
  pfsSizes,
  onCreated,
  defaultName,
  defaultPfsRef,
  lockPfsRef = false,
}: QuickCreateSizeModalProps) {
  const backdrop = useBackdropClose(onClose);
  const router = useRouter();
  const toast = useToast();
  // Quand la PFS est verrouillée (import), on a déjà la référence — pas besoin
  // que le module annexes soit dispo pour créer la taille.
  const pfsAvailable = pfsSizes.length > 0 || (lockPfsRef && !!defaultPfsRef);

  const [name, setName] = useState(defaultName ?? "");
  const [pfsRef, setPfsRef] = useState(defaultPfsRef ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [triedSubmit, setTriedSubmit] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName ?? "");
    setPfsRef(defaultPfsRef ?? "");
    setError("");
    setTriedSubmit(false);
  }, [open, defaultName, defaultPfsRef]);

  const pfsOptions = useMemo(
    () => [
      { value: "", label: "— Choisir —" },
      ...pfsSizes.map((p) => ({ value: p.reference, label: p.label })),
    ],
    [pfsSizes]
  );

  const canSubmit = name.trim().length > 0 && pfsRef.length > 0 && !submitting;
  const nameEmpty = triedSubmit && name.trim().length === 0;
  const pfsEmpty = triedSubmit && pfsRef.length === 0;

  async function handleSubmit() {
    setTriedSubmit(true);
    if (!name.trim()) {
      setError("Le nom est requis.");
      return;
    }
    if (!pfsRef) {
      setError("La référence Paris Fashion Shop est obligatoire.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await createSize(name.trim(), pfsRef);
      const resolvedRef = created.pfsSizeRef ?? pfsRef;
      toast.success(`Taille « ${created.name} » créée.`);
      onCreated({
        id: created.id,
        name: created.name,
        pfsSizeRef: resolvedRef,
      });
      router.refresh();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: "min(90vh, 560px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-base font-semibold font-heading text-text-primary">
              Créer une taille
            </h3>
            <p className="text-xs text-text-muted font-body mt-0.5">
              Elle sera ajoutée à votre bibliothèque et disponible partout.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-bg-secondary rounded-xl transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Nom */}
          <div>
            <label className="block text-sm font-body font-semibold text-text-secondary mb-1.5">
              Nom de la taille <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) { e.preventDefault(); handleSubmit(); } }}
              placeholder="ex : M, 42, T38, Taille unique"
              autoFocus
              className={`field-input w-full text-sm ${nameEmpty ? "border-[#EF4444]" : ""}`}
            />
          </div>

          {/* PFS ref */}
          <div>
            <label className="block text-sm font-body font-semibold text-text-secondary mb-1.5">
              Référence Paris Fashion Shop <span className="text-[#EF4444]">*</span>
            </label>
            {lockPfsRef ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-muted border border-border text-sm font-body text-text-primary">
                <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="truncate">{pfsRef || "—"}</span>
              </div>
            ) : pfsAvailable ? (
              <CustomSelect
                value={pfsRef}
                onChange={(v) => setPfsRef(v)}
                options={pfsOptions}
                placeholder="Rechercher la référence PFS…"
                emptyMessage="Aucune référence trouvée"
                searchable
                className={pfsEmpty ? "border-[#EF4444]" : ""}
              />
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#7F1D1D] font-body">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>PFS indisponible — impossible de créer la taille pour l&apos;instant.</span>
              </div>
            )}
            <p className="text-xs text-text-muted font-body mt-1.5">
              {lockPfsRef
                ? "Valeur reprise du produit Paris Fashion Shop — non modifiable depuis cet écran."
                : "Elle permet de synchroniser la taille avec votre flux Paris Fashion Shop."}
            </p>
            {!lockPfsRef && pfsAvailable && (
              <PfsSuggestions
                mode="ref"
                query={name}
                options={pfsSizes.map((p) => p.reference)}
                currentValue={pfsRef}
                onPick={(ref) => setPfsRef(ref)}
                label="Correspondance détectée d'après le nom"
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-[#EF4444] font-body" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-border bg-bg-primary rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-xl hover:bg-bg-secondary transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || !pfsAvailable}
            title={!canSubmit ? "Renseignez le nom et la référence PFS." : undefined}
            className="px-5 py-2 text-sm font-medium font-body text-text-inverse bg-bg-dark rounded-xl hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Création…" : "Créer la taille"}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}
