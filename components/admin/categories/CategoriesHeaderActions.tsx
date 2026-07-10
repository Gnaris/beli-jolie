"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useDeeplEnabled } from "@/components/admin/DeeplConfigContext";
import { useRightRail } from "@/components/admin/widgets-rail";
import CreateCategoryTrigger from "@/components/admin/categories/CreateCategoryTrigger";

interface TranslateItem {
  /** Clé préfixée "cat:xxx" ou "sub:xxx" pour distinguer les 2 lots. */
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

/**
 * Le bouton envoie DEUX lots séparés (catégories + sous-catégories) car le
 * worker travaille par entityType. La clé "cat:xxx" / "sub:xxx" sert ici de
 * discriminant côté client — le composant les scinde avant l'appel API.
 */
export default function CategoriesHeaderActions({ items }: Props) {
  const toast = useToast();
  const translationEnabled = useDeeplEnabled();
  const rail = useRightRail();
  const [sending, setSending] = useState(false);

  const missing = items.filter((i) => !i.hasTranslations && i.text.trim());
  const catItems = missing
    .filter((i) => i.id.startsWith("cat:"))
    .map((i) => ({ id: i.id.slice(4), text: i.text }));
  const subItems = missing
    .filter((i) => i.id.startsWith("sub:"))
    .map((i) => ({ id: i.id.slice(4), text: i.text }));
  const totalMissing = catItems.length + subItems.length;

  async function handleClick() {
    if (totalMissing === 0 || sending) return;
    setSending(true);
    try {
      const requests: Promise<Response>[] = [];
      if (catItems.length > 0) {
        requests.push(
          fetch("/api/admin/translation-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              section: "Catégories",
              entityType: "category",
              items: catItems,
            }),
          }),
        );
      }
      if (subItems.length > 0) {
        requests.push(
          fetch("/api/admin/translation-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              section: "Sous-catégories",
              entityType: "subcategory",
              items: subItems,
            }),
          }),
        );
      }
      const results = await Promise.all(requests);
      if (results.some((r) => !r.ok)) throw new Error("Erreur au démarrage");
      toast.success(
        "Traduction lancée",
        `${totalMissing} élément${totalMissing > 1 ? "s" : ""} — visible dans le tiroir à droite`,
      );
      rail.open("translation");
    } catch {
      toast.error("Traduction", "Impossible de démarrer le lot");
    } finally {
      setSending(false);
    }
  }

  if (!translationEnabled) return <div className="flex gap-2 items-center"><CreateCategoryTrigger /></div>;

  return (
    <div className="flex gap-2 items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={sending || totalMissing === 0}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-black text-text-inverse text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
        title={totalMissing === 0 ? "Rien à traduire" : `Envoyer ${totalMissing} élément(s) dans le tiroir`}
      >
        {sending ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Envoi…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
            </svg>
            Tout traduire
            {totalMissing > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {totalMissing}
              </span>
            )}
          </>
        )}
      </button>
      <CreateCategoryTrigger />
    </div>
  );
}
