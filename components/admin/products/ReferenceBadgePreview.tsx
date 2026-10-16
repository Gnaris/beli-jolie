"use client";

/**
 * Aperçu DOM du badge « RÉFÉRENCE » tel qu'il sera cuit dans l'image à
 * l'export. Reprend les proportions / couleurs / letter-spacing du badge
 * serveur `lib/branded-image.ts` variant « standard » pour que la cliente voie
 * dans la lightbox exactement ce qui atterrira dans son fichier téléchargé.
 *
 * Deux variantes :
 *   - `size="zoom"`  : plein écran (lightbox large) — ~22 % du conteneur.
 *   - `size="thumb"` : vignette (feuille d'action, aperçu dans un bouton) —
 *                      ~45 % du conteneur, texte raccourci.
 *
 * Positionnement : absolute top-right. Le parent doit être `relative` et
 * `overflow-hidden` (sinon le badge dépasse).
 */

interface Props {
  reference: string;
  size?: "zoom" | "thumb";
}

export default function ReferenceBadgePreview({ reference, size = "zoom" }: Props) {
  const trimmed = reference.trim();
  if (!trimmed) return null;

  const isThumb = size === "thumb";

  // Dimensions calculées en %/em pour rester fidèles au badge serveur sans
  // avoir à mesurer l'image parent côté JS. Les valeurs correspondent
  // visuellement à `BADGE_VARIANTS.standard` (voir lib/branded-image.ts) :
  //   - widthPct ≈ 0.40 de l'image parent
  //   - headerFontPct ≈ 0.085 → cornerRadius 6, padYPct 0.42
  const widthClass = isThumb ? "w-[45%]" : "w-[40%]";
  const marginClass = isThumb ? "top-[2%] right-[2%]" : "top-[2%] right-[2%]";
  const headerFontClass = isThumb ? "text-[6px] sm:text-[7px]" : "text-[11px] sm:text-[13px]";
  const codeFontClass = isThumb ? "text-[9px] sm:text-[11px]" : "text-[16px] sm:text-[20px]";
  const headerPadClass = isThumb ? "py-[2px]" : "py-[6px]";
  const codePadClass = isThumb ? "py-[3px] px-[6px]" : "py-[7px] px-[10px]";

  return (
    <div
      className={`pointer-events-none absolute ${marginClass} ${widthClass} rounded-md overflow-hidden shadow-[0_2px_3px_rgba(15,23,42,0.35)]`}
    >
      {/* Bande header */}
      <div
        className={`flex items-center justify-center text-center ${headerPadClass}`}
        style={{
          background: "linear-gradient(135deg, #334155 0%, #0f172a 100%)",
        }}
      >
        <span
          className={`${headerFontClass} font-bold text-slate-50 tracking-[0.18em]`}
          style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          RÉFÉRENCE
        </span>
      </div>
      {/* Bande code */}
      <div
        className={`flex items-center justify-center text-center ${codePadClass}`}
        style={{
          background: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
        }}
      >
        <span
          className={`${codeFontClass} font-bold text-white leading-none truncate`}
          style={{ fontFamily: "Consolas, 'Courier New', monospace" }}
        >
          {trimmed}
        </span>
      </div>
    </div>
  );
}
