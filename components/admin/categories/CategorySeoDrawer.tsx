"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import {
  getCategorySeo,
  updateCategorySeo,
  type CategorySeoPayload,
} from "@/app/actions/admin/categories";

type Props = {
  open: boolean;
  onClose: () => void;
  categoryId: string | null;
  categoryName: string;
  categorySlug: string;
};

const EMPTY_PAYLOAD: CategorySeoPayload = {
  seoTitle: null,
  seoIntro: null,
  seoSecondary: null,
  seoFaq: [],
};

export default function CategorySeoDrawer({
  open,
  onClose,
  categoryId,
  categoryName,
  categorySlug,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payload, setPayload] = useState<CategorySeoPayload>(EMPTY_PAYLOAD);

  useEffect(() => {
    if (!open || !categoryId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await getCategorySeo(categoryId);
      if (cancelled) return;
      if (res.success) setPayload(res.data);
      else toast.error(res.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, categoryId, toast]);

  if (!mounted || !open || !categoryId) return null;

  function patch(next: Partial<CategorySeoPayload>) {
    setPayload((prev) => ({ ...prev, ...next }));
  }

  function updateFaqItem(index: number, key: "q" | "a", value: string) {
    setPayload((prev) => {
      const faq = prev.seoFaq.slice();
      faq[index] = { ...faq[index], [key]: value };
      return { ...prev, seoFaq: faq };
    });
  }

  function addFaqItem() {
    setPayload((prev) => ({ ...prev, seoFaq: [...prev.seoFaq, { q: "", a: "" }] }));
  }

  function removeFaqItem(index: number) {
    setPayload((prev) => {
      const faq = prev.seoFaq.slice();
      faq.splice(index, 1);
      return { ...prev, seoFaq: faq };
    });
  }

  async function handleSave() {
    if (!categoryId) return;
    setSaving(true);
    const res = await updateCategorySeo(categoryId, payload);
    setSaving(false);
    if (res.success) {
      if (res.translated) {
        toast.success("SEO enregistré", "Version anglaise traduite automatiquement.");
      } else {
        toast.success("SEO enregistré", "La traduction anglaise a échoué — trame par défaut EN affichée.");
      }
      router.refresh();
      onClose();
    } else {
      toast.error(res.error);
    }
  }

  const previewHref = `/fr/categories/${categorySlug}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-black/30"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div className="relative w-full sm:w-1/2 sm:min-w-[640px] h-full bg-bg-primary shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b border-border bg-bg-primary">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">
                Page publique — SEO
              </div>
              <h3 className="mt-1 text-lg font-bold text-text-primary truncate">
                {categoryName}
              </h3>
              <a
                href={previewHref}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary underline underline-offset-2"
              >
                Aperçu <span aria-hidden>↗</span>
              </a>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-3 rounded-lg bg-bg-secondary border border-border px-3 py-2 text-[12px] text-text-secondary leading-relaxed">
            Vous éditez uniquement le français. La version anglaise est régénérée automatiquement à chaque enregistrement.
          </div>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="text-sm text-text-muted">Chargement…</div>
          ) : (
            <>
              <FieldTextarea
                label="Titre H1 / SEO"
                placeholder={`Grossiste ${categoryName.toLowerCase()} femme`}
                helper="Recommandé : 40-60 caractères. C'est aussi le titre affiché dans Google."
                value={payload.seoTitle ?? ""}
                rows={2}
                onChange={(v) => patch({ seoTitle: v || null })}
                maxLength={255}
              />

              <FieldTextarea
                label="Paragraphe d'introduction"
                placeholder="Positionnement, minimum, livraison…"
                helper="~2-3 phrases. Servira aussi de meta description Google."
                value={payload.seoIntro ?? ""}
                rows={4}
                onChange={(v) => patch({ seoIntro: v || null })}
              />

              <FieldTextarea
                label="Paragraphe secondaire"
                placeholder="Fabricants, tailles, saisons…"
                helper="~2-3 phrases complémentaires. Facultatif mais recommandé pour le SEO."
                value={payload.seoSecondary ?? ""}
                rows={4}
                onChange={(v) => patch({ seoSecondary: v || null })}
              />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12.5px] font-semibold text-text-primary">
                    Questions fréquentes (FAQ)
                  </label>
                  <button
                    type="button"
                    onClick={addFaqItem}
                    className="text-[12px] text-text-secondary hover:text-text-primary font-semibold"
                  >
                    + Ajouter une question
                  </button>
                </div>
                <p className="text-[11.5px] text-text-muted mb-3">
                  Affichées en accordéon en bas de la page. La section est masquée si vous ne mettez aucune question.
                </p>
                {payload.seoFaq.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-[12.5px] text-text-muted">
                    Aucune question — la section FAQ n'apparaîtra pas sur la page publique.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {payload.seoFaq.map((item, i) => (
                      <div key={i} className="rounded-lg border border-border bg-bg-secondary p-3">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={item.q}
                              onChange={(e) => updateFaqItem(i, "q", e.target.value)}
                              placeholder="Question"
                              className="w-full h-9 px-3 rounded-md border border-border bg-bg-primary text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary"
                            />
                            <textarea
                              value={item.a}
                              onChange={(e) => updateFaqItem(i, "a", e.target.value)}
                              rows={3}
                              placeholder="Réponse"
                              className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary resize-y"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFaqItem(i)}
                            aria-label="Supprimer cette question"
                            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-text-muted hover:text-[#BE123C] hover:bg-[#FEE2E2]"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-bg-secondary border border-border p-3 text-[12px] text-text-secondary leading-relaxed">
                <strong className="text-text-primary">Astuce :</strong> laissez vide n'importe quel champ pour utiliser la trame par défaut générée automatiquement à partir du nom de la catégorie. Chaque champ est indépendant.
              </div>
            </>
          )}
        </div>

        {/* Footer sticky */}
        <div className="sticky bottom-0 z-10 px-6 py-3 border-t border-border bg-bg-primary flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary text-[13px] font-semibold"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="h-10 px-4 rounded-lg bg-text-primary text-text-inverse hover:opacity-90 text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? "Enregistrement + traduction…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface FieldProps {
  label: string;
  placeholder?: string;
  helper?: string;
  value: string;
  rows: number;
  onChange: (v: string) => void;
  maxLength?: number;
}
function FieldTextarea({ label, placeholder, helper, value, rows, onChange, maxLength }: FieldProps) {
  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-text-primary mb-1">{label}</label>
      {helper && <p className="text-[11.5px] text-text-muted mb-1.5">{helper}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary resize-y"
      />
    </div>
  );
}
