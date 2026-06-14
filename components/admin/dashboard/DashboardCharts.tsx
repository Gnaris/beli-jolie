"use client";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

/** Read CSS variables so Recharts inline styles use theme colors */
function useChartColors() {
  return useMemo(() => {
    if (typeof window === "undefined") return { primary: "#1A1A1A", grid: "#F0F0F0", tick: "#9CA3AF" };
    const s = getComputedStyle(document.documentElement);
    return {
      primary: s.getPropertyValue("--color-bg-dark").trim() || "#1A1A1A",
      grid: "#F0F0F0",
      tick: s.getPropertyValue("--color-text-muted").trim() || "#9CA3AF",
    };
  }, []);
}

export type MonthlyPoint = { label: string; orders: number; revenue: number };
export type StatusPoint = { status: string; count: number };
export type TopProduct = { name: string; qty: number };

interface Props {
  monthlyData: MonthlyPoint[];
  statusDist: StatusPoint[];
  topProducts: TopProduct[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#F59E0B",
  SHIPPED: "#22C55E",
  CANCELLED: "#9CA3AF",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Nouveau",
  SHIPPED: "Expédiée",
  CANCELLED: "Annulée",
};

function formatEur(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-primary border border-border rounded-xl px-4 py-3 shadow-md text-sm font-body">
      <p className="font-semibold text-text-primary mb-1">{label}</p>
      <p className="text-text-primary">{formatEur(payload[0].value)}</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OrdersTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-primary border border-border rounded-xl px-4 py-3 shadow-md text-sm font-body">
      <p className="font-semibold text-text-primary mb-1">{label}</p>
      <p className="text-text-primary">{payload[0].value} commande{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

type Accent = "emerald" | "sky" | "amber" | "violet";

function ChartCard({
  accent, eyebrow, title, children,
}: {
  accent: Accent;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const cfg = {
    emerald: {
      stripe: "from-emerald-400 to-emerald-600",
      cardBg: "bg-gradient-to-br from-emerald-50/70 via-bg-primary to-bg-primary",
      border: "border-emerald-200",
      dotBg: "bg-emerald-500",
      eyebrowText: "text-emerald-700",
      halo: "bg-emerald-300/40",
    },
    sky: {
      stripe: "from-sky-400 to-sky-600",
      cardBg: "bg-gradient-to-br from-sky-50/70 via-bg-primary to-bg-primary",
      border: "border-sky-200",
      dotBg: "bg-sky-500",
      eyebrowText: "text-sky-700",
      halo: "bg-sky-300/40",
    },
    amber: {
      stripe: "from-amber-400 to-amber-600",
      cardBg: "bg-gradient-to-br from-amber-50/70 via-bg-primary to-bg-primary",
      border: "border-amber-200",
      dotBg: "bg-amber-500",
      eyebrowText: "text-amber-700",
      halo: "bg-amber-300/40",
    },
    violet: {
      stripe: "from-violet-400 to-violet-600",
      cardBg: "bg-gradient-to-br from-violet-50/70 via-bg-primary to-bg-primary",
      border: "border-violet-200",
      dotBg: "bg-violet-500",
      eyebrowText: "text-violet-700",
      halo: "bg-violet-300/40",
    },
  }[accent];

  return (
    <div className={`relative overflow-hidden ${cfg.cardBg} border ${cfg.border} rounded-2xl shadow-sm hover:shadow-md transition-all`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${cfg.stripe}`} />
      <div className={`absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl ${cfg.halo} pointer-events-none`} />
      <div className="relative p-4 sm:p-5 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotBg}`} />
          <span className={`font-body text-[10px] sm:text-[11px] uppercase tracking-[0.15em] font-semibold ${cfg.eyebrowText}`}>
            {eyebrow}
          </span>
        </div>
        <p className="font-heading font-semibold text-text-primary text-sm sm:text-base mb-4">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

export default function DashboardCharts({ monthlyData, statusDist, topProducts }: Props) {
  const maxQty = topProducts.length > 0 ? Math.max(...topProducts.map((p) => p.qty)) : 1;
  const c = useChartColors();

  const statusData = statusDist.map((s) => ({
    name: STATUS_LABELS[s.status] ?? s.status,
    value: s.count,
    color: STATUS_COLORS[s.status] ?? "#9CA3AF",
  }));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Row 1 — Area + Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Revenue AreaChart */}
        <ChartCard accent="emerald" eyebrow="Chiffre d'affaires" title="Revenus sur 6 mois">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthlyData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c.primary} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={c.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: c.tick, fontFamily: "var(--font-roboto)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: c.tick, fontFamily: "var(--font-roboto)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}€`}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={c.primary}
                strokeWidth={2}
                fill="url(#revenueGrad)"
                dot={false}
                activeDot={{ r: 4, fill: c.primary }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Orders BarChart */}
        <ChartCard accent="sky" eyebrow="Volume" title="Commandes sur 6 mois">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: c.tick, fontFamily: "var(--font-roboto)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: c.tick, fontFamily: "var(--font-roboto)" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<OrdersTooltip />} />
              <Bar dataKey="orders" fill={c.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2 — Pie + Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Status PieChart */}
        <ChartCard accent="amber" eyebrow="Répartition" title="Distribution des statuts">
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-text-muted font-body">
              Aucune commande
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-[#6B7280]" style={{ fontSize: 11, fontFamily: "var(--font-roboto)" }}>
                      {value}
                    </span>
                  )}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [`${value} commande${value !== 1 ? "s" : ""}`, ""]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border, #E5E5E5)",
                    backgroundColor: "var(--color-bg-primary, #FFFFFF)",
                    color: "var(--color-text-primary, #1A1A1A)",
                    fontSize: 12,
                    fontFamily: "var(--font-roboto)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Top 5 products — horizontal bars */}
        <ChartCard accent="violet" eyebrow="Best-sellers" title="Top 5 produits commandés">
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-[180px] text-sm text-text-muted font-body">
              Aucune donnée
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              {topProducts.map((product, i) => {
                const pct = maxQty > 0 ? Math.round((product.qty / maxQty) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-body text-text-primary font-medium truncate max-w-[75%]">
                        {product.name}
                      </span>
                      <span className="text-xs font-body text-[#6B7280] shrink-0 ml-2">
                        {product.qty} unité{product.qty !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="w-full bg-[#F0F0F0] rounded-full h-2">
                      <div
                        className="bg-bg-dark h-2 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
