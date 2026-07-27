"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Persistance des filtres/recherches de la page /admin/produits dans le
 * localStorage du navigateur. Sauve la searchParams courante à chaque
 * changement, et au retour sur la page (URL nue) restaure automatiquement
 * la dernière vue affichée par l'utilisatrice.
 *
 * Concrètement :
 *  1. À chaque changement de searchParams, on écrit `searchParams.toString()`
 *     sous la clé `admin-produits-filters-v1`. Si l'URL est nue, on supprime
 *     la clé — permet au bouton « Effacer » de vraiment tout remettre à zéro.
 *  2. Au montage, si l'URL est nue (ou ne contient que `tab=produits`), on
 *     lit le localStorage. Si une trace y est stockée, on redirige
 *     silencieusement via `router.replace(...)` — pas d'entrée dans
 *     l'historique du navigateur.
 *
 * Chaque navigateur / poste conserve sa propre trace (pas partagée entre
 * appareils). Choix validé avec l'utilisatrice.
 */
const STORAGE_KEY = "admin-produits-filters-v1";

/**
 * Détermine si l'URL courante est « nue » du point de vue des filtres produits.
 * On considère `tab=produits` équivalent à pas de tab (c'est l'onglet par
 * défaut). Toute autre valeur de `tab` doit court-circuiter la restauration
 * (l'utilisatrice regarde une autre bibliothèque).
 *
 * Exporté pour les tests unitaires — pas d'API publique.
 */
export function isBlankProductsUrl(sp: URLSearchParams): boolean {
  const tab = sp.get("tab");
  if (tab && tab !== "produits") return false;
  for (const [k, v] of sp.entries()) {
    if (k === "tab") continue;
    if (v !== "") return false;
  }
  return true;
}

export function AdminProductsFilterPersistence() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const didRestore = useRef(false);

  // (1) Restauration au premier montage — une seule fois par session de page.
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    if (typeof window === "undefined") return;

    const sp = new URLSearchParams(searchString);
    if (!isBlankProductsUrl(sp)) return;

    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!saved) return;

    const savedSp = new URLSearchParams(saved);
    if (isBlankProductsUrl(savedSp)) return;

    router.replace(`${pathname}?${saved}`, { scroll: false });
  }, [router, pathname, searchString]);

  // (2) Sauvegarde à chaque changement effectif de searchParams.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sp = new URLSearchParams(searchString);
      if (isBlankProductsUrl(sp)) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, searchString);
      }
    } catch {
      // localStorage désactivé (mode privé, quota atteint) — silencieux.
    }
  }, [searchString]);

  return null;
}
