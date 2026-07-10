"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type BrandingCtx = {
  shopName: string;
  setShopName: (name: string) => void;
};

const Ctx = createContext<BrandingCtx | null>(null);

export function WizardBrandingProvider({
  initialShopName,
  children,
}: {
  initialShopName: string;
  children: ReactNode;
}) {
  const [shopName, setShopName] = useState(initialShopName);
  return (
    <Ctx.Provider value={{ shopName, setShopName }}>{children}</Ctx.Provider>
  );
}

export function useWizardBranding() {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useWizardBranding must be used inside <WizardBrandingProvider>",
    );
  }
  return v;
}

export function shopInitial(shopName: string): string {
  const trimmed = shopName.trim();
  if (!trimmed) return "M";
  return Array.from(trimmed)[0].toLocaleUpperCase("fr-FR");
}
