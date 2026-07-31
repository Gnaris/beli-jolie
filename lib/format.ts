/**
 * Helpers de formatage FR (prix, poids, quantités).
 *
 * Motivation : on a du `.toFixed(2).replace(".", ",") + " €"` et des
 * `new Intl.NumberFormat("fr-FR", …)` inline un peu partout. Centraliser
 * évite les dérives (arrondi, séparateur, symbole) et facilite un
 * futur passage multi-devise.
 *
 * Pour les dates, utiliser `lib/format-date.ts` (existe déjà).
 */

const PRICE_FR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PRICE_FR_NO_CENTS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const WEIGHT_KG_FR = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const INT_FR = new Intl.NumberFormat("fr-FR");

/** Formate un prix en euros FR ("12,34 €"). Renvoie "—" si valeur invalide. */
export function formatPrice(value: number | null | undefined, opts?: { hideCents?: boolean }): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return opts?.hideCents ? PRICE_FR_NO_CENTS.format(value) : PRICE_FR.format(value);
}

/** Formate un poids en kg FR ("1,25 kg"). Renvoie "—" si valeur invalide. */
export function formatWeightKg(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  return `${WEIGHT_KG_FR.format(kg)} kg`;
}

/** Formate un poids donné en grammes vers "1,25 kg" ou "250 g". */
export function formatWeightFromGrams(grams: number | null | undefined): string {
  if (grams == null || !Number.isFinite(grams)) return "—";
  if (grams >= 1000) return formatWeightKg(grams / 1000);
  return `${INT_FR.format(Math.round(grams))} g`;
}

/** Formate un entier avec séparateur FR ("1 234"). */
export function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return INT_FR.format(Math.round(value));
}

/** Formate un pourcentage FR ("12,5 %"). Accepte 0-1 ou 0-100 via `basis`. */
export function formatPercent(value: number | null | undefined, opts?: { basis?: "unit" | "percent"; digits?: number }): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = opts?.digits ?? 1;
  const asPercent = opts?.basis === "unit" ? value * 100 : value;
  const fmt = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${fmt.format(asPercent)} %`;
}
