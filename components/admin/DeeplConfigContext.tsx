"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface DeeplConfig {
  enabled: boolean;
  autoTranslateEnabled: boolean;
  quotaExhausted: boolean;
  setQuotaExhausted: (v: boolean) => void;
}

const DeeplConfigContext = createContext<DeeplConfig>({
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
  const [quotaExhausted, setQuotaExhaustedState] = useState(false);
  const setQuotaExhausted = useCallback((v: boolean) => setQuotaExhaustedState(v), []);

  return (
    <DeeplConfigContext.Provider value={{ enabled, autoTranslateEnabled, quotaExhausted, setQuotaExhausted }}>
      {children}
    </DeeplConfigContext.Provider>
  );
}

export function useDeeplEnabled() {
  return useContext(DeeplConfigContext).enabled;
}

export function useAutoTranslateEnabled() {
  return useContext(DeeplConfigContext).autoTranslateEnabled;
}

export function useDeeplQuota() {
  const { quotaExhausted, setQuotaExhausted } = useContext(DeeplConfigContext);
  return { quotaExhausted, setQuotaExhausted };
}
