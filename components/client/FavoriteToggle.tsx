"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";

interface Props {
  productId: string;
  isFavorite: boolean;
  className?: string;
  /** Callback déclenché à chaque clic, dès la bascule optimiste (avant la
   *  réponse réseau). Pratique pour retirer immédiatement une carte d'une
   *  liste de favoris quand l'utilisatrice désactive le cœur. */
  onChange?: (isFavorite: boolean) => void;
}

export default function FavoriteToggle({ productId, isFavorite: propFavorite, className, onChange }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(propFavorite);

  // Synchronise l'état local quand la prop change (ex : la liste des favoris
  // arrive du serveur après le chargement initial). Sans ça, un useState
  // initialisé à `false` ne se mettra jamais à jour quand le parent passe
  // `true` après son fetch.
  useEffect(() => {
    setIsFavorite(propFavorite);
  }, [propFavorite]);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push("/connexion");
      return;
    }

    // Mode fire-and-forget : on bascule l'icône instantanément et on lance la
    // requête sans l'attendre. Aucune attente réseau côté UI. La requête est
    // idempotente côté serveur (deleteMany + create), donc même si un clic
    // rapide envoie plusieurs requêtes l'état final reste cohérent. `keepalive`
    // garantit que la requête part même si l'onglet est fermé juste après.
    const next = !isFavorite;
    setIsFavorite(next);
    onChange?.(next);

    fetch("/api/favorites", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      body:        JSON.stringify({ productId }),
      credentials: "include",
      keepalive:   true,
    }).catch(() => {
      // Erreur réseau : on rollback discrètement à l'état précédent.
      setIsFavorite(!next);
      onChange?.(!next);
    });
  }

  return (
    <button
      onClick={handleClick}
      aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      aria-pressed={isFavorite}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        isFavorite
          ? "bg-bg-dark text-text-inverse shadow-md"
          : "bg-white/90 text-text-muted hover:text-text-primary hover:bg-white shadow-sm"
      } ${className ?? ""}`}
    >
      <svg
        className="w-4 h-4"
        fill={isFavorite ? "currentColor" : "none"}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
        />
      </svg>
    </button>
  );
}
