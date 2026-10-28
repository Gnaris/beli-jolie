"use client";

import { useRef, useState } from "react";
import SmartImage from "@/components/ui/SmartImage";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { updateCategoryImage } from "@/app/actions/admin/categories";
import { VALID_LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import SubCategoryChips from "./SubCategoryChips";
import { formatDate } from "@/lib/format-date";

type Sub = {
  id: string;
  name: string;
  translations: Record<string, string>;
  orderchampCategoryPath?: string | null;
  orderchampLabel?: string | null;
  microstoreCategoryId?: number | null;
  microstoreLabel?: string | null;
  sageArticleCode?: string | null;
};
export type CategoryDetailData = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  translations: Record<string, string>;
  productCount: number;
  createdAt: Date;
  subCategories: Sub[];
  pfsLabel: string | null;
  efashionLabel: string | null;
  faireLabel: string | null;
  orderchampLabel: string | null;
  microstoreLabel: string | null;
  sageLabel: string | null;
};

type Marketplace = "pfs" | "efashion" | "faire" | "orderchamp" | "microstore" | "sage";

type Props = {
  category: CategoryDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSubAdd: () => void;
  onSubEdit: (sub: Sub) => void;
  onSubDelete: (sub: Sub) => void;
  onSubOrderchamp: (sub: Sub) => void;
  onSubMicrostore: (sub: Sub) => void;
  onSubSage: (sub: Sub) => void;
  onEditMapping: (mp: Marketplace) => void;
  onImageChange: (nextImage: string | null) => void;
  onEditSeo: () => void;
};

const MARKETPLACES: { key: Marketplace; label: string; initial: string; gradient: string }[] = [
  { key: "pfs",        label: "PFS",        initial: "P", gradient: "from-[#4f46e5] to-[#6366f1]" },
  { key: "efashion",   label: "eFashion",   initial: "E", gradient: "from-[#db2777] to-[#ec4899]" },
  { key: "faire",      label: "Faire",      initial: "F", gradient: "from-[#f59e0b] to-[#fbbf24]" },
  { key: "orderchamp", label: "Orderchamp", initial: "O", gradient: "from-[#F97316] to-[#FDBA74]" },
  { key: "microstore", label: "Microstore", initial: "M", gradient: "from-[#0891b2] to-[#22d3ee]" },
  { key: "sage",       label: "Sage",       initial: "S", gradient: "from-[#10b981] to-[#059669]" },
];

export default function CategoryDetail({
  category,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
  onSubAdd,
  onSubEdit,
  onSubDelete,
  onSubOrderchamp,
  onSubMicrostore,
  onSubSage,
  onEditMapping,
  onImageChange,
  onEditSeo,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const monogram = category.name.trim().charAt(0).toUpperCase() || "•";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("id", category.id);
      const res = await fetch("/api/admin/categories/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur upload.");
      await updateCategoryImage(category.id, data.path);
      onImageChange(data.path);
      toast.success("Image enregistrée");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur upload.";
      toast.error("Upload impossible", msg);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemoveImage() {
    const ok = await confirm({
      type: "danger",
      title: "Retirer l'image ?",
      message: `La catégorie « ${category.name} » affichera à nouveau la lettre « ${monogram} » sur fond noir.`,
      confirmLabel: "Retirer",
    });
    if (!ok) return;
    try {
      await updateCategoryImage(category.id, null);
      onImageChange(null);
      toast.success("Image retirée");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur suppression.";
      toast.error("Suppression impossible", msg);
    }
  }

  const mktValues: Record<Marketplace, string | null> = {
    pfs: category.pfsLabel,
    efashion: category.efashionLabel,
    faire: category.faireLabel,
    orderchamp: category.orderchampLabel,
    microstore: category.microstoreLabel,
    sage: category.sageLabel,
  };

  return (
    <div className="flex flex-col bg-bg-primary border border-border rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
      {/* === HEADER COMPACT === */}
      <header className="bg-bg-primary border-b border-border px-4 md:px-6 py-4">
        <div className="flex items-start gap-3 md:gap-4">
          {/* Back mobile */}
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour à la liste"
              className="md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary mt-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Avatar cliquable = upload image */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={category.image ? "Changer l'image" : "Ajouter une image"}
            className="relative group shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-full overflow-hidden border border-border bg-slate-900 grid place-items-center disabled:opacity-50"
          >
            {category.image ? (
              <SmartImage
                src={category.image}
                alt={category.name}
                width={128}
                height={128}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="text-xl md:text-2xl font-heading font-semibold text-white leading-none">{monogram}</span>
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
              {uploading ? (
                <svg className="w-5 h-5 text-white animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              )}
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFile} className="sr-only" />

          {/* Nom + méta */}
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] md:text-[20px] font-bold tracking-tight text-text-primary truncate">
              {category.name}
            </h2>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary mt-0.5 flex-wrap">
              <span className="font-medium">{category.productCount} produit{category.productCount > 1 ? "s" : ""}</span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span>{category.subCategories.length} sous-cat.</span>
              <span aria-hidden className="hidden sm:inline w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="hidden sm:inline">créée le {formatDate(category.createdAt)}</span>
            </div>
          </div>

          {/* Actions — icônes compactes desktop, menu mobile aligné */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Renommer la catégorie"
              title="Renommer"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            {category.image && (
              <button
                type="button"
                onClick={handleRemoveImage}
                aria-label="Retirer l'image"
                title="Retirer l'image"
                className="hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              aria-label="Supprimer la catégorie"
              title="Supprimer"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#BE123C] hover:bg-[#FFF1F2] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M4.772 5.79l1.068 13.883A2.25 2.25 0 008.084 21.75h7.832a2.25 2.25 0 002.244-2.077L19.228 5.79M5.79 5.79a48.11 48.11 0 013.478-.397m0 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 013.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 017.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* === CORPS : 2 blocs séparés côte à côte sur grand écran === */}
      <div className="px-4 md:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
          {/* ────────────── BLOC INFORMATION CATÉGORIE ────────────── */}
          <section
            aria-label="Informations de la catégorie"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-5 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Informations
              </h3>
            </header>

            {/* Section Traductions */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                Traductions
              </h4>
              <div className="flex flex-col gap-1.5">
                {VALID_LOCALES.map((code) => {
                  const value = category.translations[code];
                  const filled = !!value && !!value.trim();
                  return (
                    <div
                      key={code}
                      title={value || `${code.toUpperCase()} : manquant`}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] ${
                        filled
                          ? "bg-bg-primary text-text-primary border border-border"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
                      }`}
                    >
                      <span className="shrink-0 w-7 text-[10px] font-bold tracking-wider opacity-80">
                        {LOCALE_LABELS[code]}
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {filled ? value : "manquant"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-muted mt-2">
                Pour corriger, cliquez sur l'icône crayon en haut à droite.
              </p>
            </div>

            {/* Section Sous-catégories (en dessous) */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                Sous-catégories
                <span className="ml-2 text-text-secondary font-semibold normal-case tracking-normal">
                  ({category.subCategories.length})
                </span>
              </h4>
              <SubCategoryChips
                subs={category.subCategories}
                onAdd={onSubAdd}
                onEdit={onSubEdit}
                onDelete={onSubDelete}
                onOrderchamp={onSubOrderchamp}
                onMicrostore={onSubMicrostore}
                onSage={onSubSage}
              />
            </div>
          </section>

          {/* ────────────── BLOC MARKETPLACES ────────────── */}
          <section
            aria-label="Mappings marketplaces"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-3 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Marketplaces
              </h3>
            </header>

            {/* Lignes marketplaces — 1 par ligne, pleine largeur du bloc */}
            <ul className="flex flex-col gap-1.5">
              {MARKETPLACES.map((m) => {
                const value = mktValues[m.key];
                const mapped = !!value;
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onEditMapping(m.key)}
                      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-bg-primary hover:border-border-dark hover:bg-bg-tertiary transition-colors text-left"
                    >
                      <span
                        aria-hidden
                        className={`shrink-0 w-8 h-8 rounded-full bg-gradient-to-br ${m.gradient} grid place-items-center text-white text-[12px] font-bold`}
                      >
                        {m.initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-text-primary">
                            {m.label}
                          </span>
                          <span
                            aria-hidden
                            className={`inline-block w-1.5 h-1.5 rounded-full ${mapped ? "bg-emerald-500" : "bg-amber-400"}`}
                            title={mapped ? "Mappé" : "Non mappé"}
                          />
                        </div>
                        <div
                          className={`text-[12px] truncate ${mapped ? "text-text-secondary" : "text-text-muted italic"}`}
                          title={value ?? "Non mappé"}
                        >
                          {value ?? "Non mappé"}
                        </div>
                      </div>
                      <span className="shrink-0 text-[12px] text-text-muted group-hover:text-text-primary font-medium inline-flex items-center gap-1">
                        <span className="hidden sm:inline">{mapped ? "Modifier" : "Choisir"}</span>
                        <span aria-hidden>→</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Page publique SEO — pied, pleine largeur */}
        <section className="mt-5 pt-4 border-t border-border">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
                Page publique
              </h3>
              <p className="text-[12px] text-text-secondary mt-1 truncate">
                <code className="px-1 py-0.5 rounded bg-bg-secondary text-[11px] text-text-primary">
                  /fr/categories/{category.slug}
                </code>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onEditSeo}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-border-dark text-[12px] font-semibold transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Personnaliser SEO
              </button>
              <a
                href={`/fr/categories/${category.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 h-8 px-2.5 text-text-secondary hover:text-text-primary text-[12px] font-semibold"
              >
                Voir <span aria-hidden>↗</span>
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
