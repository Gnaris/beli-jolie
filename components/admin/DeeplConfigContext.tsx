"use client";

/**
 * Contexte de configuration "traduction" — conservé sous le nom historique
 * `DeeplConfigContext` pour ne pas casser les imports existants. Désormais
 * branché sur la disponibilité du compte PFS (qui fournit la traduction).
 *
 * - `enabled`              : true si la traduction PFS est utilisable
 * - `autoTranslateEnabled` : true si l'auto-traduction est activée en réglages
 * - `quotaExhausted`       : toujours false (l'API PFS n'a pas de quota au caractère)
 */

import { createContext, useContext } from "react";

interface TranslationConfig {
  enabled: boolean;
  autoTranslateEnabled: boolean;
  quotaExhausted: boolean;
  setQuotaExhausted: (v: boolean) => void;
}

const TranslationConfigContext = createContext<TranslationConfig>({
  enabled: false,
  autoTranslateEnabled: false,
  quotaExhausted: false,
  setQuotaExhausted: () => {},
});

export function DeeplConfigProvider({
  enabled,
  autoTranslateEnabled = false,
  children,
}: {
  enabled: boolean;
  autoTranslateEnabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TranslationConfigContext.Provider
      value={{
        enabled,
        autoTranslateEnabled,
        quotaExhausted: false,
        setQuotaExhausted: () => {},
      }}
    >
      {children}
    </TranslationConfigContext.Provider>
  );
}

export function useDeeplEnabled() {
  return useContext(TranslationConfigContext).enabled;
}

export function useAutoTranslateEnabled() {
  return useContext(TranslationConfigContext).autoTranslateEnabled;
}

export function useDeeplQuota() {
  const { quotaExhausted, setQuotaExhausted } = useContext(TranslationConfigContext);
  return { quotaExhausted, setQuotaExhausted };
}
