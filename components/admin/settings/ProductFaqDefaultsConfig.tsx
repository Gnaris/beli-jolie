"use client";

import { useState } from "react";
import { updateProductFaqDefaults } from "@/app/actions/admin/product-faq";
import { useToast } from "@/components/ui/Toast";
import type { ProductFaqDefault } from "@/lib/product-faq";

interface Props {
  initialItems: ProductFaqDefault[];
}

const TITLE_MAX = 120;
const BODY_MAX = 2000;
const MAX_ITEMS = 15;

interface Draft {
  key: string;
  id: string;
  title: string;
  body: string;
}

function nextKey() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toDraft(item: ProductFaqDefault): Draft {
  return { key: nextKey(), id: item.id, title: item.title, body: item.body };
}

function emptyDraft(): Draft {
  return { key: nextKey(), id: "", title: "", body: "" };
}

export default function ProductFaqDefaultsConfig({ initialItems }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initialItems.length > 0 ? initialItems.map(toDraft) : [],
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function updateField(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addItem() {
    if (drafts.length >= MAX_ITEMS) return;
    setDrafts((prev) => [...prev, emptyDraft()]);
  }

  function removeItem(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function moveItem(key: string, direction: "up" | "down") {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      if (idx === -1) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateProductFaqDefaults({
        items: drafts.map((d) => ({
          id: d.id || undefined,
          title: d.title,
          body: d.body,
        })),
      });
      if (result.success && result.items) {
        // Resynchronise les ids générés côté serveur (nouveaux items) pour que
        // les surcharges produit puissent se brancher dessus sans un refresh.
        setDrafts((prev) =>
          prev
            .map((d) => {
              const title = d.title.trim();
              if (!title) return null;
              const match = result.items!.find(
                (it) => it.title === title.slice(0, TITLE_MAX),
              );
              return match ? { ...d, id: match.id } : d;
            })
            .filter((d): d is Draft => d !== null),
        );
        toast({
          type: "success",
          title: "Enregistré",
          message: "Rubriques « Foire aux informations » mises à jour.",
        });
      } else {
        toast({
          type: "error",
          title: "Erreur",
          message: result.error || "Erreur lors de l'enregistrement.",
        });
      }
    } catch {
      toast({
        type: "error",
        title: "Erreur",
        message: "Erreur lors de la sauvegarde.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-muted font-body">
        Rubriques affichées sous chaque fiche produit (ex : « Tailles et
        mesures », « Livraison », « Entretien »…). Chaque fiche produit peut
        remplacer le texte par un contenu spécifique via l&apos;onglet « Foire
        aux informations » dans son formulaire. Jusqu&apos;à {MAX_ITEMS}{" "}
        rubriques — vide = aucune rubrique affichée.
      </p>

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-bg-secondary p-8 text-center">
          <p className="text-sm text-text-muted font-body">
            Aucune rubrique pour le moment. Les fiches produit affichent
            uniquement leur description.
          </p>
          <button
            type="button"
            onClick={addItem}
            className="btn-primary mt-4"
          >
            + Ajouter une première rubrique
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((d, index) => (
            <div
              key={d.key}
              className="rounded-2xl border border-border bg-bg-primary p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-secondary border border-border text-xs font-body font-semibold text-text-primary">
                    {index + 1}
                  </span>
                  <span className="text-sm font-body font-semibold text-text-primary">
                    Rubrique n°{index + 1}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveItem(d.key, "up")}
                    disabled={index === 0}
                    className="p-1.5 rounded-lg border border-border hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Monter"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(d.key, "down")}
                    disabled={index === drafts.length - 1}
                    className="p-1.5 rounded-lg border border-border hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Descendre"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(d.key)}
                    className="p-1.5 rounded-lg border border-border hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700"
                    aria-label="Supprimer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                  Titre de la rubrique
                </label>
                <input
                  type="text"
                  value={d.title}
                  onChange={(e) =>
                    updateField(d.key, {
                      title: e.target.value.slice(0, TITLE_MAX),
                    })
                  }
                  placeholder="Ex : Tailles et mesures"
                  className="field-input"
                />
                <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                  {d.title.length} / {TITLE_MAX}
                </p>
              </div>

              <div>
                <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
                  Texte par défaut
                </label>
                <textarea
                  value={d.body}
                  onChange={(e) =>
                    updateField(d.key, {
                      body: e.target.value.slice(0, BODY_MAX),
                    })
                  }
                  rows={4}
                  placeholder="Ex : Nos modèles sont indicatifs, prévoyez une marge d'1 à 2 cm."
                  className="field-input resize-y min-h-[100px]"
                />
                <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
                  {d.body.length} / {BODY_MAX}
                </p>
              </div>
            </div>
          ))}

          {drafts.length < MAX_ITEMS && (
            <button
              type="button"
              onClick={addItem}
              className="w-full rounded-2xl border-2 border-dashed border-border py-4 text-sm font-body font-medium text-text-secondary hover:bg-bg-secondary hover:border-text-muted transition"
            >
              + Ajouter une rubrique ({drafts.length} / {MAX_ITEMS})
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-5 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
