import { prisma } from "@/lib/prisma";
import { getVisitStats, type PeriodVisitStats } from "@/lib/visit-stats";
import {
  DEFAULT_PERIOD,
  getPeriodRange,
  type PeriodKey,
  type BucketGranularity,
} from "@/lib/dashboard-period";

/**
 * Agrégations tableau de bord (refonte 2026-10-21 — maquette ShopAdmin).
 * Un seul passage BDD par bloc via `Promise.all`. Aucune mise en cache :
 * le dashboard est consulté ponctuellement, les montants doivent être frais.
 * Les commandes CANCELLED sont exclues partout — elles ne génèrent pas de CA.
 */

export interface SparkPoint { label: string; value: number }

export interface KpiBlock {
  label: string;
  value: number;
  format: "money" | "integer";
  deltaPct: number | null; // null = pas de point de comparaison
  deltaReference: string;  // "vs. mois précédent", "vs. hier"...
  spark: SparkPoint[];     // ~14 points
  accent: "blue" | "green" | "purple" | "cyan";
  iconKey: "cart" | "receipt" | "box" | "users";
}

export interface RevenueBucket {
  /** Libellé court affiché sous la barre (ex: "15", "Lu 14", "S42", "Jan"). */
  label: string;
  /** Libellé long pour tooltip (ex: "15 oct. 2026", "sem. 42 du 12 oct."). */
  longLabel: string;
  revenue: number;
  orders: number;
}

export interface CategorySlice {
  name: string;
  sales: number;   // unités vendues (somme OrderItem.quantity)
  revenue: number;
  share: number;   // 0..1
  color: string;   // couleur hex pour le camembert
}

export interface TopProduct {
  reference: string;
  name: string;
  sales: number;
  revenue: number;
  imagePath: string | null;
}

export interface LowStockItem {
  productId: string;
  productRef: string;
  name: string;
  colorLabel: string;
  stock: number;
  threshold: number;
  severity: "critical" | "low" | "warn";
  imagePath: string | null;
}

export interface MarketingBlock {
  visits: number;
  conversionRate: number; // 0..1
  avgBasket: number;
  weeklyVisits: { label: string; count: number; pct: number }[]; // 7 derniers jours (Lun→Dim ordre naturel)
}

export interface InactiveClientRow {
  id: string;
  initials: string;
  name: string;
  email: string;
  phone: string;
  hasWhatsapp: boolean | null;
  /** Dernière activité connue (max de lastSeenAt / lastLoginAt). Null = jamais connecté depuis l'inscription. */
  lastActiveAt: Date | null;
  /** Fallback utilisé pour afficher le temps d'inactivité quand lastActiveAt est null. */
  signedUpAt: Date;
}

export interface DashboardOverview {
  period: PeriodKey;
  /** Libellé lisible de la période active ("Octobre 2026", "16 oct. – 22 oct. 2026"). */
  periodLabel: string;
  kpis: {
    /** CA cumulé sur la période active. */
    totalRevenue: KpiBlock;
    /** CA du jour (toujours "aujourd'hui", indépendant du picker). */
    todayRevenue: KpiBlock;
    /** Nombre de commandes sur la période active. */
    totalOrders: KpiBlock;
    /** Clients APPROVED (cumul lifetime), delta = nouveaux clients période. */
    uniqueClients: KpiBlock;
  };
  revenueBuckets: RevenueBucket[];
  categoryBreakdown: CategorySlice[];
  categoryTotal: number;
  topProducts: TopProduct[];
  lowStock: LowStockItem[];
  inactiveClients: InactiveClientRow[];
  marketing: MarketingBlock;
  todayVisits: PeriodVisitStats;
}

// ───── Helpers date ────────────────────────────────────────────────────────
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); }
function dateKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function pct(a: number, b: number): number | null { if (b === 0) return a > 0 ? 1 : null; return (a - b) / b; }

// ───── Fetch principal ─────────────────────────────────────────────────────
export async function getDashboardOverview(
  opts: { period?: PeriodKey } = {},
): Promise<DashboardOverview> {
  const now = new Date();
  const period = opts.period ?? DEFAULT_PERIOD;
  const range = getPeriodRange(period, now);

  const todayStart = startOfDay(now);
  const yesterdayStart = daysAgo(1);
  const last14Start = daysAgo(13);

  // Filtres période active (CA, commandes, top produits, catégories, pays).
  const periodWhere = { status: { not: "CANCELLED" as const }, createdAt: { gte: range.start, lt: range.end } };
  const prevPeriodWhere = { status: { not: "CANCELLED" as const }, createdAt: { gte: range.previousStart, lt: range.previousEnd } };

  const [
    todayAgg,
    yesterdayAgg,
    periodAgg,
    prevPeriodAgg,
    orders14d,
    uniqueClientsCount,
    newClientsPeriod,
    newClientsPrevPeriod,
    periodOrdersRaw,
    categoryItemsRaw,
    topProductsRaw,
    lowStockRaw,
    inactiveClientsRaw,
    visitStats,
    productLookup,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: todayStart } },
      _sum: { totalTTC: true }, _count: { id: true },
    }),
    prisma.order.aggregate({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: yesterdayStart, lt: todayStart } },
      _sum: { totalTTC: true }, _count: { id: true },
    }),
    prisma.order.aggregate({
      where: periodWhere,
      _sum: { totalTTC: true }, _count: { id: true },
    }),
    prisma.order.aggregate({
      where: prevPeriodWhere,
      _sum: { totalTTC: true }, _count: { id: true },
    }),
    // Détail 14 jours pour les sparklines (CA + orders)
    prisma.order.findMany({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: last14Start } },
      select: { createdAt: true, totalTTC: true },
    }),
    // Nombre de clients APPROVED (compte global — toujours lifetime)
    prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
    // Nouveaux clients période active vs précédente (pour le delta)
    prisma.user.count({
      where: { role: "CLIENT", status: "APPROVED", createdAt: { gte: range.start, lt: range.end } },
    }),
    prisma.user.count({
      where: { role: "CLIENT", status: "APPROVED", createdAt: { gte: range.previousStart, lt: range.previousEnd } },
    }),
    // CA par bucket sur la période active (granularité adaptative)
    prisma.order.findMany({
      where: periodWhere,
      select: { createdAt: true, totalTTC: true },
    }),
    // Vente par catégorie sur la période active
    prisma.orderItem.findMany({
      where: { order: periodWhere },
      select: { productRef: true, quantity: true, lineTotal: true },
    }),
    // Top produits sur la période active (jusqu'à 100 pour listing complet)
    prisma.orderItem.groupBy({
      by: ["productRef"],
      where: { order: periodWhere },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 100,
    }),
    // Stock faible — ProductColor avec stock < 10, non désactivée
    prisma.productColor.findMany({
      where: { disabled: false, stock: { gt: 0, lt: 10 } },
      orderBy: { stock: "asc" },
      take: 5,
      select: {
        id: true, stock: true,
        color: { select: { name: true } },
        images: { select: { path: true }, take: 1, orderBy: { order: "asc" } },
        product: {
          select: { id: true, reference: true, name: true, status: true },
        },
      },
    }),
    // Clients les moins récents (candidats pour relance). On prend un paquet
    // large trié par lastSeenAt (nulls en premier = jamais vu) et on raffine
    // en JS avec max(lastSeenAt, lastLoginAt) pour trouver les vrais "oubliés".
    prisma.user.findMany({
      where: { role: "CLIENT", status: "APPROVED" },
      orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }],
      take: 50,
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        company: true, hasWhatsapp: true,
        lastSeenAt: true, lastLoginAt: true, createdAt: true,
      },
    }),
    // Visites
    getVisitStats(),
    // Produits pour hydrater top produits (image + nom + categoryId)
    prisma.product.findMany({
      select: {
        id: true, reference: true, name: true, categoryId: true,
        category: { select: { name: true } },
        colors: {
          take: 1,
          orderBy: [{ isPrimary: "desc" }],
          select: { images: { take: 1, orderBy: { order: "asc" }, select: { path: true } } },
        },
      },
    }),
  ]);

  // ─── KPI calculs ─────────────────────────────────────────────────────────
  const periodRevenue = Number(periodAgg._sum.totalTTC ?? 0);
  const periodOrdersCount = periodAgg._count.id;
  const prevPeriodRevenue = Number(prevPeriodAgg._sum.totalTTC ?? 0);
  const prevPeriodOrders = prevPeriodAgg._count.id;

  const todayRevenue = Number(todayAgg._sum.totalTTC ?? 0);
  const todayOrdersCount = todayAgg._count.id;
  const yesterdayRevenue = Number(yesterdayAgg._sum.totalTTC ?? 0);
  const yesterdayOrdersCount = yesterdayAgg._count.id;

  // Séries 14j (CA + nb commandes par jour)
  const spark14Revenue: Map<string, number> = new Map();
  const spark14Orders: Map<string, number> = new Map();
  for (let i = 13; i >= 0; i--) spark14Revenue.set(dateKey(daysAgo(i)), 0);
  for (let i = 13; i >= 0; i--) spark14Orders.set(dateKey(daysAgo(i)), 0);
  for (const o of orders14d) {
    const k = dateKey(o.createdAt);
    spark14Revenue.set(k, (spark14Revenue.get(k) ?? 0) + Number(o.totalTTC));
    spark14Orders.set(k, (spark14Orders.get(k) ?? 0) + 1);
  }
  const revenueSparkPoints: SparkPoint[] = Array.from(spark14Revenue.entries()).map(([k, v]) => ({ label: k, value: v }));
  const ordersSparkPoints: SparkPoint[] = Array.from(spark14Orders.entries()).map(([k, v]) => ({ label: k, value: v }));

  // Sparkline "aujourd'hui" : on reprend le CA journalier 14j (évolution)
  const todaySparkPoints: SparkPoint[] = revenueSparkPoints.slice(-7);

  // Sparkline clients : nouveaux clients approuvés par jour (14j)
  const newClientsByDay = await prisma.user.findMany({
    where: { role: "CLIENT", createdAt: { gte: last14Start } },
    select: { createdAt: true },
  });
  const spark14Clients: Map<string, number> = new Map();
  for (let i = 13; i >= 0; i--) spark14Clients.set(dateKey(daysAgo(i)), 0);
  for (const u of newClientsByDay) {
    const k = dateKey(u.createdAt);
    spark14Clients.set(k, (spark14Clients.get(k) ?? 0) + 1);
  }
  const clientsSparkPoints: SparkPoint[] = Array.from(spark14Clients.entries()).map(([k, v]) => ({ label: k, value: v }));

  const kpis = {
    totalRevenue: {
      label: labelForRevenueKpi(period),
      value: periodRevenue, format: "money" as const,
      deltaPct: pct(periodRevenue, prevPeriodRevenue),
      deltaReference: range.deltaReference,
      spark: revenueSparkPoints,
      accent: "blue" as const, iconKey: "cart" as const,
    },
    todayRevenue: {
      label: "Chiffre d'affaires du jour",
      value: todayRevenue, format: "money" as const,
      deltaPct: pct(todayRevenue, yesterdayRevenue),
      deltaReference: "vs. hier",
      spark: todaySparkPoints,
      accent: "green" as const, iconKey: "receipt" as const,
    },
    totalOrders: {
      label: labelForOrdersKpi(period),
      value: periodOrdersCount, format: "integer" as const,
      deltaPct: pct(periodOrdersCount, prevPeriodOrders),
      deltaReference: range.deltaReference,
      spark: ordersSparkPoints,
      accent: "purple" as const, iconKey: "box" as const,
    },
    uniqueClients: {
      label: "Clients uniques",
      value: uniqueClientsCount, format: "integer" as const,
      deltaPct: pct(newClientsPeriod, newClientsPrevPeriod),
      deltaReference: range.deltaReference,
      spark: clientsSparkPoints,
      accent: "cyan" as const, iconKey: "users" as const,
    },
  };

  // ─── CA par bucket (granularité adaptative selon la période) ─────────────
  const revenueBuckets = bucketizeRevenue(periodOrdersRaw, range.start, range.end, range.bucketGranularity);

  // ─── Vente par catégorie ─────────────────────────────────────────────────
  // Besoin : agréger quantité + revenu par catégorie via Product.categoryId.
  const refToProduct = new Map(productLookup.map((p) => [p.reference, p]));
  const catMap = new Map<string, { name: string; sales: number; revenue: number }>();
  for (const it of categoryItemsRaw) {
    const p = refToProduct.get(it.productRef);
    const catName = p?.category?.name ?? "Autres";
    const existing = catMap.get(catName) ?? { name: catName, sales: 0, revenue: 0 };
    existing.sales += it.quantity;
    existing.revenue += Number(it.lineTotal);
    catMap.set(catName, existing);
  }
  const categoryEntries = Array.from(catMap.values()).sort((a, b) => b.revenue - a.revenue);
  const categoryTotal = categoryEntries.reduce((s, c) => s + c.revenue, 0);
  const CAT_COLORS = ["#246bfe", "#08a66a", "#ff9e2c", "#8055f6", "#ff5360", "#08b8ce", "#aab7cb"];
  const TOP_CAT_COUNT = 5;
  const topCats = categoryEntries.slice(0, TOP_CAT_COUNT);
  const otherCatsRevenue = categoryEntries.slice(TOP_CAT_COUNT).reduce((s, c) => s + c.revenue, 0);
  const otherCatsSales = categoryEntries.slice(TOP_CAT_COUNT).reduce((s, c) => s + c.sales, 0);
  const totalForShare = categoryTotal > 0 ? categoryTotal : 1;
  const categoryBreakdown: CategorySlice[] = topCats.map((c, i) => ({
    name: c.name, sales: c.sales, revenue: c.revenue,
    share: c.revenue / totalForShare, color: CAT_COLORS[i] ?? "#aab7cb",
  }));
  if (otherCatsRevenue > 0 && categoryEntries.length > TOP_CAT_COUNT) {
    categoryBreakdown.push({
      name: "Autres", sales: otherCatsSales, revenue: otherCatsRevenue,
      share: otherCatsRevenue / totalForShare, color: "#aab7cb",
    });
  }

  // ─── Top 5 produits ──────────────────────────────────────────────────────
  const topProducts: TopProduct[] = topProductsRaw.map((row) => {
    const p = refToProduct.get(row.productRef);
    const img = p?.colors?.[0]?.images?.[0]?.path ?? null;
    return {
      reference: row.productRef,
      name: p?.name ?? row.productRef,
      sales: row._sum.quantity ?? 0,
      revenue: Number(row._sum.lineTotal ?? 0),
      imagePath: img,
    };
  });

  // ─── Stock faible ────────────────────────────────────────────────────────
  const lowStock: LowStockItem[] = lowStockRaw
    .filter((v) => v.product.status !== "ARCHIVED")
    .map((v) => {
      const severity: LowStockItem["severity"] = v.stock <= 3 ? "critical" : v.stock <= 6 ? "low" : "warn";
      return {
        productId: v.product.id,
        productRef: v.product.reference,
        name: v.product.name,
        colorLabel: v.color?.name ?? "—",
        stock: v.stock,
        threshold: 10,
        severity,
        imagePath: v.images[0]?.path ?? null,
      };
    });

  // ─── Clients inactifs (candidats relance) ────────────────────────────────
  // "Inactivité" = temps écoulé depuis la dernière activité réelle, i.e. le
  // max de (lastSeenAt, lastLoginAt). Si les deux sont null, on considère que
  // le client ne s'est jamais reconnecté depuis son inscription → on prend
  // createdAt comme repère et on affiche "Jamais connecté".
  const inactiveClients: InactiveClientRow[] = inactiveClientsRaw
    .map((u) => {
      const lastActiveMs = Math.max(
        u.lastSeenAt?.getTime() ?? 0,
        u.lastLoginAt?.getTime() ?? 0,
      );
      const lastActiveAt = lastActiveMs > 0 ? new Date(lastActiveMs) : null;
      return { u, lastActiveAt };
    })
    .sort((a, b) => {
      const aT = a.lastActiveAt?.getTime() ?? a.u.createdAt.getTime();
      const bT = b.lastActiveAt?.getTime() ?? b.u.createdAt.getTime();
      return aT - bT;
    })
    .slice(0, 5)
    .map(({ u, lastActiveAt }) => {
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.company || u.email;
      const initials = (u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "");
      return {
        id: u.id,
        initials: initials.toUpperCase() || u.email.slice(0, 2).toUpperCase(),
        name: fullName,
        email: u.email,
        phone: u.phone,
        hasWhatsapp: u.hasWhatsapp,
        lastActiveAt,
        signedUpAt: u.createdAt,
      };
    });

  // ─── Marketing ───────────────────────────────────────────────────────────
  // Visites 30j = somme (anonymous + authenticated) sur les 30 derniers jours.
  // Simplification : on prend visitStats.month (déjà calculé).
  const month = visitStats.month;
  const visits30d = month.total;
  // Conversion + panier moyen reflètent la période active (cohérent avec KPI).
  const conv = periodOrdersCount > 0 && visits30d > 0 ? periodOrdersCount / visits30d : 0;
  const avgBasket = periodOrdersCount > 0 ? periodRevenue / periodOrdersCount : 0;

  // Visites 7 derniers jours — on recalcule via prisma.visit (une seule requête)
  const weekStart = daysAgo(6);
  const weekVisits = await prisma.visit.findMany({
    where: { date: { gte: dateKey(weekStart) } },
    select: { date: true },
  });
  const weekMap = new Map<string, number>();
  const dayLabelsFr = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const weeklyVisitsBuckets: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i);
    const k = dateKey(d);
    weekMap.set(k, 0);
    weeklyVisitsBuckets.push({ label: dayLabelsFr[d.getDay()], count: 0 });
  }
  for (const v of weekVisits) {
    weekMap.set(v.date, (weekMap.get(v.date) ?? 0) + 1);
  }
  // Remappe dans le bon ordre
  let idx = 0;
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i);
    const k = dateKey(d);
    weeklyVisitsBuckets[idx].count = weekMap.get(k) ?? 0;
    idx++;
  }
  const maxWeekly = Math.max(1, ...weeklyVisitsBuckets.map((b) => b.count));
  const weeklyVisits = weeklyVisitsBuckets.map((b) => ({
    label: b.label, count: b.count, pct: (b.count / maxWeekly) * 100,
  }));

  const marketing: MarketingBlock = { visits: visits30d, conversionRate: conv, avgBasket, weeklyVisits };

  // (todayOrdersCount, yesterdayOrdersCount gardés uniquement pour clarté — pas réexposés directement)
  void todayOrdersCount; void yesterdayOrdersCount;

  return {
    period,
    periodLabel: range.label,
    kpis,
    revenueBuckets,
    categoryBreakdown,
    categoryTotal,
    topProducts,
    lowStock,
    inactiveClients,
    marketing,
    todayVisits: visitStats.today,
  };
}

// ─── Helpers labels KPI ───────────────────────────────────────────────────
function labelForRevenueKpi(period: PeriodKey): string {
  switch (period) {
    case "7d":    return "Chiffre d'affaires · 7 jours";
    case "30d":   return "Chiffre d'affaires · 30 jours";
    case "90d":   return "Chiffre d'affaires · 90 jours";
    case "year":  return "Chiffre d'affaires · année";
    case "month": return "Chiffre d'affaires du mois";
  }
}
function labelForOrdersKpi(period: PeriodKey): string {
  switch (period) {
    case "7d":    return "Commandes · 7 jours";
    case "30d":   return "Commandes · 30 jours";
    case "90d":   return "Commandes · 90 jours";
    case "year":  return "Commandes · année";
    case "month": return "Commandes du mois";
  }
}

// ─── Bucketization adaptative CA ──────────────────────────────────────────
function bucketizeRevenue(
  orders: Array<{ createdAt: Date; totalTTC: unknown }>,
  start: Date,
  end: Date,
  granularity: BucketGranularity,
): RevenueBucket[] {
  if (granularity === "day") return bucketByDay(orders, start, end);
  if (granularity === "week") return bucketByWeek(orders, start, end);
  return bucketByMonth(orders, start, end);
}

function bucketByDay(
  orders: Array<{ createdAt: Date; totalTTC: unknown }>,
  start: Date,
  end: Date,
): RevenueBucket[] {
  const buckets: RevenueBucket[] = [];
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    buckets.push({
      label: `${d.getDate()}`,
      longLabel: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      revenue: 0, orders: 0,
    });
  }
  for (const o of orders) {
    const idx = Math.floor((startOfDay(o.createdAt).getTime() - startOfDay(start).getTime()) / 86_400_000);
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx].revenue += Number(o.totalTTC);
    buckets[idx].orders += 1;
  }
  return buckets;
}

function bucketByWeek(
  orders: Array<{ createdAt: Date; totalTTC: unknown }>,
  start: Date,
  end: Date,
): RevenueBucket[] {
  // Chaque bucket couvre 7j à partir de `start` ; les semaines ne sont pas
  // alignées sur le lundi ISO — on reste collé à la fenêtre glissante
  // (ex: 90j se finit toujours à aujourd'hui, pas au dimanche précédent).
  const buckets: RevenueBucket[] = [];
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
    const bEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    const effectiveEnd = bEnd >= end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1) : bEnd;
    buckets.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      longLabel: `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${effectiveEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`,
      revenue: 0, orders: 0,
    });
  }
  const startMs = startOfDay(start).getTime();
  for (const o of orders) {
    const idx = Math.floor((startOfDay(o.createdAt).getTime() - startMs) / (7 * 86_400_000));
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx].revenue += Number(o.totalTTC);
    buckets[idx].orders += 1;
  }
  return buckets;
}

function bucketByMonth(
  orders: Array<{ createdAt: Date; totalTTC: unknown }>,
  start: Date,
  end: Date,
): RevenueBucket[] {
  const buckets: RevenueBucket[] = [];
  const indexByKey = new Map<string, number>();
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    indexByKey.set(key, buckets.length);
    buckets.push({
      label: d.toLocaleDateString("fr-FR", { month: "short" }),
      longLabel: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      revenue: 0, orders: 0,
    });
  }
  for (const o of orders) {
    const key = `${o.createdAt.getFullYear()}-${o.createdAt.getMonth()}`;
    const idx = indexByKey.get(key);
    if (idx === undefined) continue;
    buckets[idx].revenue += Number(o.totalTTC);
    buckets[idx].orders += 1;
  }
  return buckets;
}
