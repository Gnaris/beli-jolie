/**
 * Ajoute à la fin de la description produit envoyée à Orderchamp :
 *  - la composition matériaux ;
 *  - la ou les tailles disponibles (cas Taille Unique + sizeDetailsTu) ;
 *  - la mention « Made in {pays en anglais} ».
 *
 * Même format que Faire pour cohérence — voir `lib/faire-description.ts`.
 */

export interface OrderchampDescriptionComposition {
  name: string;
  percentage: number;
}

export interface OrderchampDescriptionOptions {
  sizes?: string[];
  sizeDetailsTu?: string | null;
  madeInCountryEn?: string | null;
}

export function buildOrderchampDescription(
  baseDescription: string,
  compositions: OrderchampDescriptionComposition[],
  options: OrderchampDescriptionOptions = {},
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

function formatCompositionLine(compositions: OrderchampDescriptionComposition[]): string | null {
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
