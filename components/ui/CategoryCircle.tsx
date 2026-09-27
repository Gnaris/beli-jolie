"use client";

import { useState } from "react";
import SmartImage from "@/components/ui/SmartImage";

interface Props {
  name: string;
  image?: string | null;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-24 h-24",
  md: "w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48",
  lg: "w-36 h-36 sm:w-48 sm:h-48 md:w-52 md:h-52 lg:w-64 lg:h-64",
};

const IMAGE_DIM: Record<NonNullable<Props["size"]>, number> = {
  sm: 192,
  md: 384,
  lg: 512,
};

const MONOGRAM_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-2xl",
  md: "text-3xl sm:text-4xl",
  lg: "text-4xl sm:text-5xl",
};

/**
 * Cercle catégorie — deux rendus :
 *   - avec image (photo produit ou SVG icône) : image affichée en plein
 *     cadre `object-cover`, cercle sans bordure ni fond. Sur BJ la photo
 *     est tirée d'un produit vendable de la catégorie ; sur Issyma c'est
 *     une icône SVG dédiée. Dans les deux cas, plus de liseré.
 *   - sans image : cercle plein noir, première lettre majuscule blanche
 *     (monogramme). Fallback stable, jamais moche.
 */
export default function CategoryCircle({ name, image, size = "md" }: Props) {
  const [failed, setFailed] = useState(false);
  const dim = IMAGE_DIM[size];
  const monogram = name.trim().charAt(0).toUpperCase() || "•";

  // Si l'image ne charge pas côté navigateur (fichier absent sur disque,
  // path corrompu…), on retombe sur le monogramme au lieu d'afficher le
  // texte alt dans un rectangle vide.
  if (image && !failed) {
    return (
      <div className={`${SIZE_CLASS[size]} rounded-3xl overflow-hidden`}>
        <SmartImage
          src={image}
          alt={name}
          width={dim}
          height={dim}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${SIZE_CLASS[size]} rounded-3xl bg-slate-900 text-white grid place-items-center transition-colors duration-200 group-hover:bg-black`}
    >
      <span
        aria-hidden
        className={`${MONOGRAM_CLASS[size]} font-heading font-semibold leading-none tracking-tight`}
      >
        {monogram}
      </span>
    </div>
  );
}
