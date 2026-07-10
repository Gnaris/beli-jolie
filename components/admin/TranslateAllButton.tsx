"use client";

/**
 * Bouton « Tout traduire » qui envoie un lot dans la file d'attente serveur
 * (`TranslationJob`) au lieu de traduire de manière synchrone bloquante.
 *
 * L'utilisateur voit le progrès en temps réel dans le tiroir Traduction du
 * rail droit — et peut continuer à travailler pendant que ça tourne.
 *
 * Pour les produits (name + description), utiliser `ProductTranslateAllButton`
 * qui suit un flow différent — cette route ne gère que les entités simples.
 */

import { useState } from "react";
import { useDeeplEnabled } from "@/components/admin/DeeplConfigContext";
import { useToast } from "@/components/ui/Toast";
import { useRightRail } from "@/components/admin/widgets-rail";
import type { TranslationEntityType } from "@/lib/translation-queue";

interface TranslateAllItem {
  id: string;
  /** Texte FR à traduire. */
  text: string;
  /** L'item a déjà au moins une traduction (permet d'ignorer). */
  hasTranslations: boolean;
}

interface TranslateAllButtonProps {
  /** Type d'entité — pilote la persistance côté worker. */
  entityType: TranslationEntityType;
  /** Libellé de section affiché dans le tiroir (ex : « Couleurs »). */
  section: string;
  items: TranslateAllItem[];
  /** Libellé du bouton (défaut « Tout traduire »). */
  label?: string;
  /** Ne traduit que les items sans traduction. */
  onlyMissing?: boolean;
}

export default function TranslateAllButton({
  entityType,
  section,
  items,
  label = "Tout traduire",
  onlyMissing = false,
}: TranslateAllButtonProps) {
  const translationEnabled = useDeeplEnabled();
  const toast = useToast();
  const rail = useRightRail();
  const [sending, setSending] = useState(false);

  const toTranslate = onlyMissing
    ? items.filter((i) => !i.hasTranslations && i.text.trim())
    : items.filter((i) => i.text.trim());

  const missingCount = items.filter((i) => !i.hasTranslations && i.text.trim()).length;

  async function handleClick() {
    if (toTranslate.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/translation-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          entityType,
          items: toTranslate.map((i) => ({ id: i.id, text: i.text })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Erreur au démarrage du lot");
      }
      toast.success(
        "Traduction lancée",
        `${toTranslate.length} élément${toTranslate.length > 1 ? "s" : ""} — visible dans le tiroir à droite`,
      );
      rail.open("translation");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Traduction", message);
    } finally {
      setSending(false);
    }
  }

  if (!translationEnabled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={sending || toTranslate.length === 0}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-black text-text-inverse text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
      title={
        toTranslate.length === 0
          ? "Rien à traduire"
          : `Envoyer ${toTranslate.length} élément${toTranslate.length > 1 ? "s" : ""} dans le tiroir de traduction`
      }
    >
      {sending ? (
        <>
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Envoi…
        </>
      ) : (
        <>
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802"
            />
          </svg>
          {label}
          {missingCount > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {missingCount}
            </span>
          )}
        </>
      )}
    </button>
  );
}
