"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCollection } from "@/app/actions/admin/collections";
import CollectionImageField from "@/components/admin/collections/CollectionImageField";
import TranslateButton from "@/components/admin/TranslateButton";
import TranslationFieldsBlock from "@/components/admin/TranslationFieldsBlock";
import { useAutoTranslateOnBlur } from "@/hooks/useAutoTranslateOnBlur";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

export default function NewCollectionPage() {
  const router = useRouter();
  // On stocke toutes les locales (fr + en/de/it/es) dans un seul dict —
  // même pattern que la modale de catégorie, pour que `useAutoTranslateOnBlur`
  // puisse remplir l'anglais à la perte de focus du champ FR.
  const [names, setNames] = useState<Record<string, string>>({});
  const [image, setImage] = useState<string | null>(null);
  const [imageBanner, setImageBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const { handleFrBlur, isTranslating } = useAutoTranslateOnBlur({ names, setNames });

  const frName = (names["fr"] ?? "").trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("name", frName);
    if (image) fd.append("image", image);
    if (imageBanner) fd.append("imageBanner", imageBanner);
    for (const locale of NON_DEFAULT_LOCALES) {
      const val = (names[locale] ?? "").trim();
      if (val) fd.append(`translation_${locale}`, val);
    }

    const result = await createCollection(fd);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      router.push(`/admin/collections/${result.id}/modifier`);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/collections"
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Retour"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">Nouvelle collection</h1>
          <p className="page-subtitle font-body">
            Créez une collection et ajoutez-y des produits après.
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FECACA] text-error text-sm px-4 py-2.5 rounded-xl">
            {error}
          </div>
        )}

        {/* Nom */}
        <div>
          <label className="field-label font-body">
            Nom de la collection <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={names["fr"] ?? ""}
            onChange={(e) => setNames((prev) => ({ ...prev, fr: e.target.value }))}
            onBlur={handleFrBlur}
            placeholder="ex: Été 2026, Romantique, Minimaliste…"
            required
            className="field-input"
          />
        </div>

        {/* Traductions */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="field-label font-body !mb-0">Traductions</label>
            {!autoTranslateEnabled && (
              <TranslateButton
                text={frName}
                onTranslated={(t) => setNames((prev) => ({ ...prev, ...t }))}
                disabled={!frName}
              />
            )}
          </div>
          <TranslationFieldsBlock
            names={names}
            setNames={setNames}
            isTranslating={isTranslating}
          />
          <p className="text-[11px] text-text-muted">
            {autoTranslateEnabled
              ? "L'anglais se remplit tout seul quand tu quittes le champ français. Tu peux cliquer sur « Traduire » pour les autres langues ou les saisir à la main — tes textes manuels ne sont jamais écrasés."
              : "Clique sur « Traduire » pour remplir les 4 langues d'un coup, ou saisis-les à la main."}
          </p>
        </div>

        {/* Image de la carte */}
        <CollectionImageField
          kind="card"
          value={image}
          onChange={setImage}
          slug={frName}
          onError={setError}
        />

        {/* Bannière */}
        <CollectionImageField
          kind="banner"
          value={imageBanner}
          onChange={setImageBanner}
          slug={frName}
          onError={setError}
        />

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? "Création…" : "Créer la collection"}
          </button>
          <Link href="/admin/collections" className="btn-secondary">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
