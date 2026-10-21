import { prisma } from "@/lib/prisma";
import { getVisitStats, type PeriodVisitStats } from "@/lib/visit-stats";

/**
 * Agrégation des stats pour le nouveau tableau de bord admin (style V14,
 * fusion 2026-10-21). On tape une seule fois la BDD pour chaque bloc, sans
 * cache — les montants doivent être frais, et le dashboard est consulté
 * ponctuellement (pas assez pour justifier un cache).
 *
 * Les commandes CANCELLED sont exclues partout — elles ne génèrent pas de CA.
 */

export interface TopCountry {
  /** Code ISO 3166-1 alpha-2 (ex. "FR"), fallback label brut si inconnu. */
  code: string;
  /** Nom lisible ("France"). */
  name: string;
  /** CA cumulé TTC. */
  amount: number;
  /** Part du CA total (0..1). */
  share: number;
}

export interface MonthlyRevenuePoint {
  /** 0..11 — index du mois. */
  month: number;
  amount: number;
}

export interface DashboardOverview {
  totalRevenue: number;
  totalOrdersCount: number;
  todayRevenue: number;
  todayOrdersCount: number;
  todayVisits: PeriodVisitStats;
  topCountries: TopCountry[];
  monthlyRevenue: MonthlyRevenuePoint[];
  availableYears: number[];
  activeYear: number;
}

// ───── Résolution ISO → nom pays FR ────────────────────────────────────────
// Minimal : seuls les pays qu'on voit couramment sur BJ. Pour un code non
// mappé on retombe sur le code brut (jamais vide, jamais crash).
const COUNTRY_NAMES_FR: Record<string, string> = {
  FR: "France",
  BE: "Belgique",
  ES: "Espagne",
  IT: "Italie",
  DE: "Allemagne",
  LU: "Luxembourg",
  CH: "Suisse",
  GB: "Royaume-Uni",
  NL: "Pays-Bas",
  PT: "Portugal",
  US: "États-Unis",
  CA: "Canada",
  MA: "Maroc",
  DZ: "Algérie",
  TN: "Tunisie",
};

export function countryNameFr(code: string): string {
  const up = code.toUpperCase();
  return COUNTRY_NAMES_FR[up] ?? code;
}

/** Convertit un code ISO 3166-1 alpha-2 en emoji drapeau (unicode regional
 *  indicator). Renvoie "" si input non standard (2 lettres latines). */
export function countryFlagEmoji(code: string): string {
  if (!code || code.length !== 2) return "";
  const up = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return "";
  const A = 0x1F1E6;
  return String.fromCodePoint(A + up.charCodeAt(0) - 65) + String.fromCodePoint(A + up.charCodeAt(1) - 65);
}

// ───── Fetch principal ─────────────────────────────────────────────────────

export async function getDashboardOverview(year?: number): Promise<DashboardOverview> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const activeYear = year ?? now.getFullYear();

  const [
    totalAgg,
    todayAgg,
    todayVisits,
    countriesRaw,
    monthlyRaw,
    yearsRaw,
  ] = await Promise.all([
    // CA total toutes périodes
    prisma.order.aggregate({
      where: { status: { not: "CANCELLED" } },
      _sum: { totalTTC: true },
      _count: { id: true },
    }),
    // CA du jour
    prisma.order.aggregate({
      where: {
        status: { not: "CANCELLED" },
        createdAt: { gte: todayStart },
      },
      _sum: { totalTTC: true },
      _count: { id: true },
    }),
    // Visiteurs du jour (connectés / anonymes)
    getVisitStats().then((v) => v.today),
    // Top pays — groupBy shipCountry sum totalTTC
    prisma.order.groupBy({
      by: ["shipCountry"],
      where: { status: { not: "CANCELLED" } },
      _sum: { totalTTC: true },
      orderBy: { _sum: { totalTTC: "desc" } },
      take: 5,
    }),
    // CA mensuel pour l'année active
    prisma.order.findMany({
      where: {
        status: { not: "CANCELLED" },
        createdAt: {
          gte: new Date(activeYear, 0, 1),
          lt: new Date(activeYear + 1, 0, 1),
        },
      },
      select: { createdAt: true, totalTTC: true },
    }),
    // Années disponibles (celles ayant au moins 1 commande non annulée)
    prisma.order.findMany({
      where: { status: { not: "CANCELLED" } },
      select: { createdAt: true },
      distinct: ["createdAt"],
    }),
  ]);

  const totalRevenue = Number(totalAgg._sum.totalTTC ?? 0);
  const totalOrdersCount = totalAgg._count.id;

  const todayRevenue = Number(todayAgg._sum.totalTTC ?? 0);
  const todayOrdersCount = todayAgg._count.id;

  const totalForShare = totalRevenue > 0 ? totalRevenue : 1;
  const topCountries: TopCountry[] = countriesRaw
    .filter((r) => r.shipCountry)
    .slice(0, 3)
    .map((r) => {
      const code = r.shipCountry ?? "??";
      const amount = Number(r._sum.totalTTC ?? 0);
      return {
        code,
        name: countryNameFr(code),
        amount,
        share: amount / totalForShare,
      };
    });

  // Agrégation mensuelle côté JS — plus simple et portable que SQL GROUP BY
  // sur MONTH(createdAt), suffisant pour quelques milliers de commandes/an.
  const monthlyRevenue: MonthlyRevenuePoint[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    amount: 0,
  }));
  for (const o of monthlyRaw) {
    const m = o.createdAt.getMonth();
    monthlyRevenue[m].amount += Number(o.totalTTC);
  }

  // Années triées, incluant l'année courante par défaut
  const yearsSet = new Set<number>();
  yearsSet.add(now.getFullYear());
  for (const row of yearsRaw) yearsSet.add(row.createdAt.getFullYear());
  const availableYears = Array.from(yearsSet).sort((a, b) => b - a);

  return {
    totalRevenue,
    totalOrdersCount,
    todayRevenue,
    todayOrdersCount,
    todayVisits,
    topCountries,
    monthlyRevenue,
    availableYears,
    activeYear,
  };
}
