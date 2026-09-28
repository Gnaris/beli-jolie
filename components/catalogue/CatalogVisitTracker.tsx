"use client";

import { useEffect } from "react";

/**
 * Ping l'API `/api/catalog/{token}/visit` une fois au mount pour :
 *  - Enregistrer une ligne `CatalogView` (compteur admin).
 *  - Poser le cookie de contexte signé HMAC (attribution des ajouts panier).
 *
 * Chaque nouvelle visite compte (pas de dédup) — c'est le comportement voulu
 * par la cliente : 3 visites du même utilisateur = 3 vues.
 */
export default function CatalogVisitTracker({ token }: { token: string }) {
  useEffect(() => {
    fetch(`/api/catalog/${encodeURIComponent(token)}/visit`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      /* silencieux — pas d'impact sur l'UX si le ping échoue */
    });
  }, [token]);

  return null;
}
