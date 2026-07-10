"use client";

/**
 * Bouton « Tout traduire » pour la page Produits.
 *
 * Note : contrairement au TranslateAllButton générique qui envoie dans la file
 * TranslationJob, les produits ont un couple name + description à traduire, ce
 * qui n'est pas encore couvert par le worker de queue. On garde donc l'ancien
 * flow via `batchTranslateProducts` — mais SANS le voile blanc plein écran :
 * juste un toast + le bouton passe en "envoi…".
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDeeplEnabled } from "@/components/admin/DeeplConfigContext";
import { batchTranslateProducts } from "@/app/actions/admin/batch-translations";
import { useToast } from "@/components/ui/Toast";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

interface ProductItem {
  id: string;
  name: string;
  translationLocales: string[];
}

const ALL_NON_FR_LOCALES = NON_DEFAULT_LOCALES;
const BATCH_SIZE = 25;

export default function ProductTranslateAllButton({ products }: { products: ProductItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const translationEnabled = useDeeplEnabled();
  const [busy, setBusy] = useState(false);

  const toTranslate = products.filter(
    (p) => !ALL_NON_FR_LOCALES.every((l) => p.translationLocales.includes(l)),
  );

  const handleClick = useCallback(async () => {
    if (toTranslate.length === 0 || busy) return;
    setBusy(true);
    try {
      // Batch en groupes de 25 pour ne pas passer un payload énorme à l'action.
      let completed = 0;
      for (let i = 0; i < toTranslate.length; i += BATCH_SIZE) {
        const batch = toTranslate.slice(i, i + BATCH_SIZE);
        const texts = batch.map((p) => p.name);
        const res = await fetch("/api/admin/translate-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts }),
        });
        if (!res.ok) throw new Error("Erreur traduction");
        const data = (await res.json()) as { results: Record<string, string>[] };
        const persistBatch = batch
          .map((p, idx) => ({ id: p.id, translations: data.results?.[idx] ?? {} }))
          .filter((it) => Object.keys(it.translations).length > 0);
        if (persistBatch.length > 0) {
          await batchTranslateProducts(persistBatch);
        }
        completed += batch.length;
      }
      toast.success(
        "Traductions sauvegardées",
        `${completed} produit${completed > 1 ? "s" : ""} traduit${completed > 1 ? "s" : ""}`,
      );
      router.refresh();
    } catch {
      toast.error("Erreur", "Erreur lors de la sauvegarde des traductions");
    } finally {
      setBusy(false);
    }
  }, [toTranslate, busy, router, toast]);

  if (!translationEnabled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || toTranslate.length === 0}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-black text-text-inverse text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
      title={
        toTranslate.length === 0
          ? "Rien à traduire"
          : `Traduire ${toTranslate.length} produit${toTranslate.length > 1 ? "s" : ""}`
      }
    >
      {busy ? (
        <>
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Traduction en cours…
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
          </svg>
          Tout traduire
          {toTranslate.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {toTranslate.length}
            </span>
          )}
        </>
      )}
    </button>
  );
}
