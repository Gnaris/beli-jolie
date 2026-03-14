"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import CollectionProductManager from "@/components/admin/collections/CollectionProductManager";
import { updateCollection } from "@/app/actions/admin/collections";

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
  products: CollectionItem[];
}

export default function EditCollectionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [collection, setCollection]       = useState<CollectionData | null>(null);
  const [availableProducts, setAvailable] = useState<AvailableProduct[]>([]);
  const [name, setName]                   = useState("");
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
        <div className="w-6 h-6 border-2 border-[#0F172A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/collections"
          className="text-[#475569] hover:text-[#0F172A] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
            {collection.name}
          </h1>
          <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)]">
            Modifier la collection
          </p>
        </div>
      </div>

      {/* Infos générales */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 space-y-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A]">
          Informations générales
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-md">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2.5 rounded-md">
              Collection mise à jour avec succès.
            </div>
          )}

          {/* Nom */}
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1.5 font-[family-name:var(--font-roboto)]">
              Nom <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="field-input"
            />
          </div>

          {/* Image */}
          <div>
            <label className="block text-sm font-medium text-[#0F172A] mb-1.5 font-[family-name:var(--font-roboto)]">
              Image
            </label>
            {preview ? (
              <div className="relative w-40 h-40 rounded-lg overflow-hidden border border-[#E2E8F0]">
                <img src={preview} alt="Aperçu" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => { setImage(null); setPreview(null); }}
                  className="absolute top-1.5 right-1.5 bg-white/90 rounded-full p-1 hover:bg-white shadow-sm"
                >
                  <svg className="w-3.5 h-3.5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-40 h-40 border-2 border-dashed border-[#E2E8F0] rounded-lg flex flex-col items-center justify-center gap-1.5 text-[#94A3B8] hover:border-[#94A3B8] transition-colors text-xs font-[family-name:var(--font-roboto)]"
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
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A] mb-5">
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
          className="text-sm text-[#0F3460] hover:underline font-[family-name:var(--font-roboto)]"
        >
          Voir la collection en vitrine →
        </Link>
      </div>
    </div>
  );
}
