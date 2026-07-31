"use client";

import { useCallback, useState } from "react";
import { useAutoTranslateEnabled, useDeeplEnabled } from "@/components/admin/DeeplConfigContext";

interface UseAutoTranslateOnBlurArgs {
  names: Record<string, string>;
  setNames: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Locales à remplir automatiquement (par défaut ["en"]). */
  targetLocales?: string[];
  /** Coupe le hook (ex: type="country" dont le nom est un libellé pays canonique). */
  disabled?: boolean;
}

/**
 * Déclenche la traduction automatique du champ FR vers les locales cibles quand
 * l'utilisateur quitte le focus du champ français, à trois conditions :
 *   1) la traduction automatique est activée (SiteConfig `auto_translate_enabled`);
 *   2) le compte PFS (fournisseur de la traduction) est configuré;
 *   3) la valeur cible (ex: EN) est vide — sinon on respecte la saisie manuelle.
 *
 * Pendant l'appel réseau, `isTranslating(locale)` renvoie true : les composants
 * (ex: `TranslatingInput`) affichent un overlay « Traduction en cours… » et
 * bloquent la saisie.
 */
export function useAutoTranslateOnBlur({
  names,
  setNames,
  targetLocales = ["en"],
  disabled = false,
}: UseAutoTranslateOnBlurArgs) {
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const translationEnabled = useDeeplEnabled();
  const [translating, setTranslating] = useState<Record<string, boolean>>({});

  const handleFrBlur = useCallback(async () => {
    if (disabled) return;
    if (!autoTranslateEnabled || !translationEnabled) return;

    const frValue = (names["fr"] ?? "").trim();
    if (!frValue) return;

    // Locales cibles à remplir : celles qui sont vides ET pas déjà en cours de
    // traduction (évite un double fetch si l'utilisateur re-blur rapidement).
    const localesToFill = targetLocales.filter(
      (l) => !(names[l] ?? "").trim() && !translating[l],
    );
    if (localesToFill.length === 0) return;

    setTranslating((prev) => {
      const next = { ...prev };
      for (const l of localesToFill) next[l] = true;
      return next;
    });

    try {
      const res = await fetch("/api/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: frValue }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const translations = (data?.translations ?? {}) as Record<string, string>;

      setNames((prev) => {
        const next = { ...prev };
        for (const l of localesToFill) {
          // Ne remplir que si le champ est resté vide (l'utilisateur peut avoir
          // saisi manuellement pendant l'appel réseau).
          if (!(next[l] ?? "").trim() && translations[l]?.trim()) {
            next[l] = translations[l];
          }
        }
        return next;
      });
    } catch {
      // Silencieux — un échec réseau ne doit pas casser l'UI. L'utilisateur
      // peut saisir manuellement ou re-blur.
    } finally {
      setTranslating((prev) => {
        const next = { ...prev };
        for (const l of localesToFill) delete next[l];
        return next;
      });
    }
  }, [names, setNames, targetLocales, autoTranslateEnabled, translationEnabled, disabled, translating]);

  const isTranslating = useCallback(
    (locale: string) => !!translating[locale],
    [translating],
  );

  return { handleFrBlur, isTranslating, translating };
}
