import SmartImage from "@/components/ui/SmartImage";

interface Props {
  name: string;
  image?: string | null;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-20 h-20",
  md: "w-24 h-24 sm:w-28 sm:h-28",
  lg: "w-28 h-28 sm:w-32 sm:h-32 lg:w-36 lg:h-36",
};

const IMAGE_DIM: Record<NonNullable<Props["size"]>, number> = {
  sm: 160,
  md: 240,
  lg: 320,
};

const MONOGRAM_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-2xl",
  md: "text-3xl sm:text-4xl",
  lg: "text-4xl sm:text-5xl",
};

/**
 * Cercle catégorie — trois rendus :
 *   - avec image raster (WebP/JPG) : cercle blanc bordé fin, image détourée
 *     à 78 % (photos BJ centrées, marge visuelle autour).
 *   - avec image SVG : image affichée à 100 % sans cadre — les icônes
 *     Issyma portent déjà leur propre disque de fond, un cadre blanc
 *     créerait un liseré parasite.
 *   - sans image : cercle plein noir, première lettre majuscule blanche
 *     (monogramme). Fallback stable, jamais moche.
 */
export default function CategoryCircle({ name, image, size = "md" }: Props) {
  const dim = IMAGE_DIM[size];
  const monogram = name.trim().charAt(0).toUpperCase() || "•";

  if (image) {
    const isSvg = image.toLowerCase().endsWith(".svg");
    return (
      <div
        className={`${SIZE_CLASS[size]} rounded-full grid place-items-center overflow-hidden transition-colors duration-200 ${
          isSvg
            ? ""
            : "bg-white border border-slate-200 shadow-[var(--shadow-sm)] group-hover:border-slate-900"
        }`}
      >
        <SmartImage
          src={image}
          alt={name}
          width={dim}
          height={dim}
          className={isSvg ? "w-full h-full object-cover" : "w-[78%] h-[78%] object-contain"}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={`${SIZE_CLASS[size]} rounded-full bg-slate-900 text-white grid place-items-center transition-colors duration-200 group-hover:bg-black`}
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
