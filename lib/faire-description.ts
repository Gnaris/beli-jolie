/**
 * Ajoute à la fin de la description produit envoyée à Faire :
 *  - la composition matériaux (ce champ n'est pas exposé à l'acheteuse dans
 *    le schéma Faire) ;
 *  - la ou les tailles disponibles (avec cas spécial « Taille Unique (XX-YY) »
 *    quand une seule taille est marquée TU / Taille Unique et que le produit
 *    a un `sizeDetailsTu` renseigné) ;
 *  - la mention « Made in {pays en anglais} » d'après l'isoCode du pays de
 *    fabrication, résolu via `Intl.DisplayNames` côté appelant.
 *
 * Les dimensions et le poids passent par le champ structuré `measurements`
 * côté variante (cf. `lib/faire-publish.ts → buildFaireProductPayload`).
 * Le code SH reste envoyé en clair via `tariff_code` au niveau variante mais
 * n'est plus appendu à la description (choix cliente : pas pertinent pour
 * l'acheteuse).
 *
 * Format de sortie :
 *
 *     {description originale}
 *
 *     Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)
 *
 *     Taille Unique (38-42)
 *
 *     Made in China
 */

export interface FaireDescriptionComposition {
  /** Libellé matériau en clair (ex : "Acier inoxydable 316L"). */
  name: string;
  /** Pourcentage entier (ex : 70 pour 70%). */
  percentage: number;
}

export interface FaireDescriptionOptions {
  /** Noms des tailles disponibles (peut contenir des doublons — dédup interne). */
  sizes?: string[];
  /** Détail texte associé à la taille unique (ex : "38-42"). */
  sizeDetailsTu?: string | null;
  /** Nom du pays de fabrication en anglais (ex : "China", "France"). */
  madeInCountryEn?: string | null;
}

export function buildFaireDescription(
  baseDescription: string,
  compositions: FaireDescriptionComposition[],
  options: FaireDescriptionOptions = {},
): string {
  const lines: string[] = [];
  const base = baseDescription?.trim() ?? "";
  if (base) lines.push(base);

  const compositionLine = formatCompositionLine(compositions);
  if (compositionLine) lines.push(compositionLine);

  const sizeLine = formatSizeLine(options.sizes ?? [], options.sizeDetailsTu ?? null);
  if (sizeLine) lines.push(sizeLine);

  const countryLine = formatCountryLine(options.madeInCountryEn ?? null);
  if (countryLine) lines.push(countryLine);

  return lines.join("\n\n");
}

function formatCompositionLine(compositions: FaireDescriptionComposition[]): string | null {
  const cleaned = compositions
    .map((c) => ({ name: c.name?.trim() ?? "", percentage: Number(c.percentage) }))
    .filter((c) => c.name.length > 0);

  if (cleaned.length === 0) return null;

  const items = cleaned.map((c) => {
    const pct = Number.isFinite(c.percentage) && c.percentage > 0
      ? ` (${roundPercent(c.percentage)}%)`
      : "";
    return `${c.name}${pct}`;
  });

  return `Composition : ${items.join(", ")}`;
}

function formatSizeLine(sizes: string[], sizeDetailsTu: string | null): string | null {
  const uniqueNames = Array.from(
    new Set(
      sizes
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((n) => n.length > 0),
    ),
  );
  if (uniqueNames.length === 0) return null;

  if (uniqueNames.length === 1) {
    const only = uniqueNames[0];
    const lower = only.toLowerCase();
    if (lower === "tu" || lower === "taille unique") {
      const detail = sizeDetailsTu?.trim();
      return detail ? `Taille Unique (${detail})` : "Taille Unique";
    }
    return `Taille : ${only}`;
  }

  return `Tailles : ${uniqueNames.join(", ")}`;
}

function formatCountryLine(nameEn: string | null): string | null {
  const trimmed = nameEn?.trim();
  if (!trimmed) return null;
  return `Made in ${trimmed}`;
}

function roundPercent(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}
