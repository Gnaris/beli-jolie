import { prisma } from "@/lib/prisma";

export interface PeriodVisitStats {
  authenticated: number;
  anonymous:     number;
  total:         number;
}

export interface VisitStatsBundle {
  today:     PeriodVisitStats;
  week:      PeriodVisitStats;
  month:     PeriodVisitStats;
  year:      PeriodVisitStats;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Renvoie la chaîne YYYY-MM-DD du jour J - n jours (J-0 = aujourd'hui). */
function dateKeyDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKey(d);
}

/**
 * Compte les visites uniques (visiteurs distincts) sur une fenêtre temporelle
 * donnée, séparées par connecté / anonyme. Une "visite" = une ligne par
 * couple (visitorId, jour) : un même visiteur n'est compté qu'une fois par
 * jour, donc sur une semaine on additionne ses passages quotidiens.
 *
 * NOTE : si on voulait l'unicité du visiteur sur toute la période (et non
 * la somme des passages quotidiens), il faudrait `groupBy` sur visitorId.
 * Ici on assume que le user veut le total des passages.
 */
async function countVisits(fromDateKey: string): Promise<PeriodVisitStats> {
  const [authCount, anonCount] = await Promise.all([
    prisma.visit.count({
      where: { date: { gte: fromDateKey }, isAuthenticated: true },
    }),
    prisma.visit.count({
      where: { date: { gte: fromDateKey }, isAuthenticated: false },
    }),
  ]);

  return {
    authenticated: authCount,
    anonymous:     anonCount,
    total:         authCount + anonCount,
  };
}

export async function getVisitStats(): Promise<VisitStatsBundle> {
  const today    = dateKey(new Date());
  const sevenDay = dateKeyDaysAgo(6);   // J-6 → 7 derniers jours (incluant aujourd'hui)
  const thirty   = dateKeyDaysAgo(29);  // 30 derniers jours
  const yearAgo  = dateKeyDaysAgo(364); // 365 derniers jours

  const [t, w, m, y] = await Promise.all([
    countVisits(today),
    countVisits(sevenDay),
    countVisits(thirty),
    countVisits(yearAgo),
  ]);

  return { today: t, week: w, month: m, year: y };
}
