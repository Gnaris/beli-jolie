/**
 * Période active du tableau de bord admin.
 *
 * Un seul endroit pour :
 *   - parser le `?period=` en URL (défaut : mois en cours),
 *   - calculer la plage de dates associée + la plage précédente (pour les
 *     deltas KPI « vs. période précédente »),
 *   - décider la granularité des bars du chart CA (`day` / `week` / `month`).
 *
 * Les helpers sont pure-functions et ne touchent pas la DB : testés unitairement
 * sans mock Prisma.
 */

export type PeriodKey = "7d" | "30d" | "90d" | "year" | "month";

export const DEFAULT_PERIOD: PeriodKey = "month";

const VALID_PERIODS: Set<string> = new Set(["7d", "30d", "90d", "year", "month"]);

/** Parse le query-param `?period=` ; renvoie le défaut si vide/inconnu. */
export function parsePeriod(raw: string | string[] | undefined | null): PeriodKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && VALID_PERIODS.has(v)) return v as PeriodKey;
  return DEFAULT_PERIOD;
}

export type BucketGranularity = "day" | "week" | "month";

export interface PeriodRange {
  period: PeriodKey;
  /** Début inclusif (00:00 local). */
  start: Date;
  /** Fin exclusive (le lendemain à 00:00). */
  end: Date;
  /** Début de la période précédente de même longueur. */
  previousStart: Date;
  /** Fin exclusive de la période précédente. */
  previousEnd: Date;
  /** Libellé affiché à côté du picker ("1 oct. – 22 oct. 2026"). */
  label: string;
  /** Référence delta ("vs. 7 jours précédents" ...). */
  deltaReference: string;
  /** Bucketization des bars du chart CA. */
  bucketGranularity: BucketGranularity;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function getPeriodRange(period: PeriodKey, now: Date = new Date()): PeriodRange {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousEnd = start;
    return {
      period, start, end, previousStart, previousEnd,
      label: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      deltaReference: "vs. mois précédent",
      bucketGranularity: "day",
    };
  }

  if (period === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear() + 1, 0, 1);
    const previousStart = new Date(today.getFullYear() - 1, 0, 1);
    const previousEnd = start;
    return {
      period, start, end, previousStart, previousEnd,
      label: `${today.getFullYear()}`,
      deltaReference: "vs. année précédente",
      bucketGranularity: "month",
    };
  }

  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const start = addDays(today, -(days - 1));
  const end = tomorrow;
  const previousStart = addDays(start, -days);
  const previousEnd = start;
  return {
    period, start, end, previousStart, previousEnd,
    label: `${fmtShort(start)} – ${fmtShort(today)}`,
    deltaReference: `vs. ${days} jours précédents`,
    bucketGranularity: period === "90d" ? "week" : "day",
  };
}

/** Libellé court du picker (bouton). */
export function periodLabel(period: PeriodKey): string {
  switch (period) {
    case "7d":    return "7 jours";
    case "30d":   return "30 jours";
    case "90d":   return "90 jours";
    case "year":  return "Année";
    case "month": return "Mois en cours";
  }
}

export const PERIOD_OPTIONS: readonly PeriodKey[] = ["7d", "30d", "90d", "month", "year"];
