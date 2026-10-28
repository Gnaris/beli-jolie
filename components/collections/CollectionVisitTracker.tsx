"use client";

import { useEffect } from "react";

/**
 * Ping `/api/collection/{id}/visit` au mount pour :
 *  - Enregistrer une ligne `CollectionView` (compteur admin).
 *  - Poser le cookie de contexte signé HMAC (attribution des ajouts panier).
 *
 * Pas de dédup : parité avec `CatalogView`.
 */
export default function CollectionVisitTracker({
  collectionId,
  mode = "view",
}: {
  collectionId: string;
  /** `"view"` = log + cookie. `"context"` = cookie seul (arrivée directe via `?via=`). */
  mode?: "view" | "context";
}) {
  useEffect(() => {
    const q = mode === "context" ? "?mode=context" : "";
    fetch(`/api/collection/${encodeURIComponent(collectionId)}/visit${q}`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      /* silencieux */
    });
  }, [collectionId, mode]);

  return null;
}
