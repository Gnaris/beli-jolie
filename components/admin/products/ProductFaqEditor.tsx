"use client";

import { useState } from "react";
import { updateProductFaqOverrides } from "@/app/actions/admin/product-faq";
import { useToast } from "@/components/ui/Toast";
import type { ProductFaqDefault } from "@/lib/product-faq";

interface Props {
  productId: string;
  defaults: ProductFaqDefault[];
  initialOverrides: Record<string, string>;
}

const BODY_MAX = 2000;

export default function ProductFaqEditor({
  productId,
  defaults,
  initialOverrides,
}: Props) {
  const [overrides, setOverrides] = useState<Record<string, string>>(
    () => ({ ...initialOverrides }),
  );
  const [savedOverrides, setSavedOverrides] = useState<Record<string, string>>(
    () => ({ ...initialOverrides }),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const dirty = (() => {
    const keys = new Set([
      ...Object.keys(overrides),
      ...Object.keys(savedOverrides),
    ]);
    for (const k of keys) {
      if ((overrides[k] ?? "") !== (savedOverrides[k] ?? "")) return true;
    }
    return false;
  })();

  function updateField(id: string, value: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === "") delete next[id];
      else next[id] = value.slice(0, BODY_MAX);
      return next;
    });
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await updateProductFaqOverrides({ productId, overrides });
      if (res.success) {
        setSavedOverrides({ ...overrides });
        toast.success("Textes « Foire aux informations » enregistrés");
      } else {
        toast.error(
          "Impossible d'enregistrer",
          res.error ?? "Erreur inconnue.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (defaults.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-bg-secondary p-8 text-center space-y-2">
        <p className="text-sm text-text-muted font-body">
          Aucune rubrique de « Foire aux informations » n&apos;est configurée
          pour le moment.
        </p>
        <p className="text-xs text-text-muted font-body">
          Rendez-vous dans <span className="font-semibold">Paramètres →
          Fiche produit</span> pour en ajouter. Elles apparaîtront ensuite
          ici, prêtes à être personnalisées pour ce produit.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted font-body">
        Pour chaque rubrique, laissez vide pour utiliser le texte par défaut
        de la boutique, ou saisissez un contenu spécifique à ce produit.
      </p>

      {defaults.map((def, index) => {
        const value = overrides[def.id] ?? "";
        const usingDefault = value.trim().length === 0;
        return (
          <div
            key={def.id}
            className="rounded-2xl border border-border bg-bg-primary p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-secondary border border-border text-xs font-body font-semibold text-text-primary shrink-0">
                  {index + 1}
                </span>
                <h3 className="text-sm font-body font-semibold text-text-primary truncate">
                  {def.title}
                </h3>
              </div>
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-body font-semibold uppercase tracking-[0.05em] border ${
                  usingDefault
                    ? "bg-bg-secondary text-text-muted border-border"
                    : "bg-violet-50 text-violet-700 border-violet-200"
                }`}
              >
                {usingDefault ? "Texte par défaut" : "Texte personnalisé"}
              </span>
            </div>

            {usingDefault && def.body && (
              <div className="rounded-lg bg-bg-secondary/60 border border-dashed border-border px-3 py-2">
                <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-[0.05em] mb-1">
                  Texte par défaut
                </p>
                <p className="text-xs text-text-secondary font-body whitespace-pre-line">
                  {def.body}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                Texte spécifique à ce produit
              </label>
              <textarea
                value={value}
                onChange={(e) => updateField(def.id, e.target.value)}
                rows={4}
                placeholder={
                  def.body
                    ? "Laissez vide pour afficher le texte par défaut"
                    : "Vide = la rubrique ne s'affiche pas sur ce produit"
                }
                className="field-input resize-y min-h-[100px]"
              />
              <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                {value.length} / {BODY_MAX}
              </p>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted font-body">
          {dirty ? "Modifications non enregistrées" : "Aucune modification"}
        </span>
        {dirty && (
          <span className="text-[11px] text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 font-body">
            Modifications non enregistrées
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-body font-semibold bg-bg-dark text-text-inverse hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Enregistrement…" : "Enregistrer les textes"}
        </button>
      </div>
    </div>
  );
}
