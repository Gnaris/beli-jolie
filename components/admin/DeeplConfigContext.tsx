"use client";

import { createContext, useContext } from "react";

const DeeplConfigContext = createContext(false);

export function DeeplConfigProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <DeeplConfigContext.Provider value={enabled}>
      {children}
    </DeeplConfigContext.Provider>
  );
}

export function useDeeplEnabled() {
  return useContext(DeeplConfigContext);
}
