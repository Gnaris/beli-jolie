"use client";

import { useEffect } from "react";
import { trackProductView } from "@/app/actions/client/product-views";

/**
 * Déclencheur silencieux : au montage de la fiche /produits/[slug], on
 * enregistre une vue pour la cliente connectée (admins exclus côté serveur).
 * La limite "1 vue/jour/produit/utilisateur" est garantie par l'index unique
 * en BDD — pas de logique client à maintenir.
 */
export default function ProductViewTracker({ productId }: { productId: string }) {
  useEffect(() => {
    if (!productId) return;
    void trackProductView(productId).catch(() => {});
  }, [productId]);

  return null;
}
