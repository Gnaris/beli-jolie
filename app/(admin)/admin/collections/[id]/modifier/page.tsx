"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import CollectionProductManager from "@/components/admin/collections/CollectionProductManager";
import { updateCollection } from "@/app/actions/admin/collections";
import TranslateButton from "@/components/admin/TranslateButton";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";

interface ColorData {
  id: string;
  name: string;
  hex: string | null;
  images: { path: string }[];
}

interface CollectionItem {
  productId: string;
  colorId: string | null;
  position: number;
  product: {
    id: string;
    name: string;
    reference: string;
    colors: ColorData[];
  };
}

interface AvailableProduct {
  id: string;
  name: string;
  reference: string;
  colors: ColorData[];
}

interface CollectionData {
  id: string;
  name: string;
  image: string | null;
  translations: Record<string, string>;
  products: CollectionItem[];
}

export default function EditCollectionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [collection, setCollection]       = useState<CollectionData | null>(null);
  const [availableProducts, setAvailable] = useState<AvailableProduct[]>([]);
  const [name, setName]                   = useState("");
  const [translations, setTranslations]   = useState<Record<string, string>>({});
  const [image, setImage]                 = useState<string | null>(null);
  const [preview, setPreview]             = useState<string | null>(null);
  const [uploading, setUploading]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [success, setSuccess]             = useState(false);
  const fileRef                           = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const [colRes, prodRes] = await Promise.all([
        fetch(`/api/admin/collections/${params.id}`),
        fetch("/api/admin/collections/products"),
      ]);
      if (colRes.ok) {
        const col: CollectionData = await colRes.json();
        setCollection(col);
        setName(col.name);
        setImage(col.image);
        setPreview(col.image);
        setTranslations(col.translations ?? {});
      }
      if (prodRes.ok) {
        setAvailable(await prodRes.json());
      }
    }
    load();
  }, [params.id]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const fd = new FormData();
    fd.append("image", file);

    const res  = await fetch("/api/admin/collections/images", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Erreur upload.");
    } else {
      setImage(data.path);
      setPreview(data.path);
    }
    setUploading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const fd = new FormData();
    fd.append("name", name);
    if (image) fd.append("image", image);

    // Append translations
    for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
      if (translations[locale]) {
        fd.append(`translation_${locale}`, translations[locale]);
      }
    }

    const result = await updateCollection(params.id, fd);
    setSaving(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
  }

  if (!collection) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-bg-dark border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/collections"
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">
            {collection.name}
          </h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            Modifier la collection
          </p>
        </div>
      </div>

      {/* Infos générales */}
      <div className="card p-6 space-y-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
          Informations générales
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-[#FEE2E2] border border-[#FECACA] text-error text-sm px-4 py-2.5 rounded-xl">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-accent-light border border-accent/30 text-accent-dark text-sm px-4 py-2.5 rounded-xl">
              Collection mise à jour avec succès.
            </div>
          )}

          {/* Nom (FR) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="field-label font-[family-name:var(--font-roboto)] mb-0">
                Nom (Français) <span className="text-error">*</span>
              </label>
              <TranslateButton
                text={name}
                onTranslated={(t) => setTranslations((prev) => ({ ...prev, ...t }))}
                disabled={!name.trim()}
              />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="field-input"
            />
          </div>

          {/* Traductions */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-3">
              Traductions (optionnel)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {VALID_LOCALES.filter((l) => l !== "fr").map((locale) => (
                <div key={locale}>
                  <label className="field-label uppercase tracking-wider text-xs font-semibold font-[family-name:var(--font-roboto)]">
                    {LOCALE_FULL_NAMES[locale]}
                  </label>
                  <input
                    type="text"
                    value={translations[locale] ?? ""}
                    onChange={(e) =>
                      setTranslations((prev) => ({ ...prev, [locale]: e.target.value }))
                    }
                    className="field-input text-sm"
                    placeholder={LOCALE_FULL_NAMES[locale]}
                    dir={locale === "ar" ? "rtl" : undefined}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="field-label font-[family-name:var(--font-roboto)]">
              Image
            </label>
            {preview ? (
              <div className="relative w-40 h-40 rounded-xl overflow-hidden border border-border">
                <img src={preview} alt="Aperçu" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => { setImage(null); setPreview(null); }}
                  className="absolute top-1.5 right-1.5 bg-white/90 rounded-full p-1 hover:bg-white shadow-sm"
                >
                  <svg className="w-3.5 h-3.5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-40 h-40 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1.5 text-text-muted hover:border-border-dark hover:text-text-secondary transition-colors text-xs font-[family-name:var(--font-roboto)]"
              >
                {uploading ? "Téléchargement…" : (
                  <>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.076 11.095" />
                    </svg>
                    <span>Ajouter une image</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          <button
            type="submit"
            disabled={saving || uploading}
            className="btn-primary"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      </div>

      {/* Products manager */}
      <div className="card p-6">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary mb-5">
          Produits de la collection
        </h2>
        <CollectionProductManager
          collectionId={params.id}
          initialItems={collection.products}
          availableProducts={availableProducts}
        />
      </div>

      {/* Preview link */}
      <div className="text-right">
        <Link
          href={`/collections/${params.id}`}
          target="_blank"
          className="text-sm text-text-secondary hover:text-text-primary hover:underline font-[family-name:var(--font-roboto)]"
        >
          Voir la collection en vitrine →
        </Link>
      </div>
    </div>
  );
}
