"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toggleFavorite } from "@/app/actions/client/favorites";

interface Props {
  productId: string;
  isFavorite: boolean;
  className?: string;
}

export default function FavoriteToggle({ productId, isFavorite: initialFavorite, className }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      router.push("/connexion");
      return;
    }

    startTransition(async () => {
      const result = await toggleFavorite(productId);
      setIsFavorite(result.isFavorite);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        isFavorite
          ? "bg-[#1A1A1A] text-white shadow-md"
          : "bg-white/90 text-[#9CA3AF] hover:text-[#1A1A1A] hover:bg-white shadow-sm"
      } ${isPending ? "opacity-50" : ""} ${className ?? ""}`}
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
