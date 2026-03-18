"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Composant invisible qui track les pages visitées par un visiteur avec code d'accès.
 * S'insère dans le layout principal. N'envoie rien si pas de cookie bj_access_code.
 */
export default function AccessCodeTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string>("");

  useEffect(() => {
    // Vérifier le cookie côté client
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("bj_access_code="));
    if (!cookie) return;

    // Ne pas tracker la même page deux fois d'affilée
    if (pathname === lastTracked.current) return;
    lastTracked.current = pathname;

    // Extraire productId et productName de la page si c'est un produit
    const isProductPage = pathname.startsWith("/produits/");
    const productId = isProductPage ? pathname.split("/produits/")[1]?.split("?")[0] : undefined;

    // Récupérer le nom du produit depuis le DOM (h1 de la page produit)
    let productName: string | undefined;
    if (isProductPage) {
      // Petit délai pour laisser le DOM se charger
      setTimeout(() => {
        const h1 = document.querySelector("h1");
        productName = h1?.textContent?.trim() || undefined;

        fetch("/api/access-code/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageUrl: pathname,
            productId,
            productName,
          }),
        }).catch(() => {}); // silencieux si erreur
      }, 1000);
    } else {
      fetch("/api/access-code/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: pathname }),
      }).catch(() => {});
    }
  }, [pathname]);

  return null; // Composant invisible
}
