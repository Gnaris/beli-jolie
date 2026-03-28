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

/** Read CSS variables so Recharts inline styles adapt to dark mode */
function useChartColors() {
  return useMemo(() => {
    if (typeof window === "undefined") return { primary: "#1A1A1A", grid: "#F0F0F0", tick: "#9CA3AF" };
    const s = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.classList.contains("admin-dark");
    return {
      primary: isDark ? "#FFFFFF" : (s.getPropertyValue("--color-bg-dark").trim() || "#1A1A1A"),
      grid: isDark ? "#2E2E2E" : "#F0F0F0",
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
  PROCESSING: "#3B82F6",
  SHIPPED: "#8B5CF6",
  DELIVERED: "#22C55E",
  CANCELLED: "#9CA3AF",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  SHIPPED: "Expédiée",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

function formatEur(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl px-4 py-3 shadow-md text-sm font-[family-name:var(--font-roboto)]">
      <p className="font-semibold text-[#1A1A1A] mb-1">{label}</p>
      <p className="text-[#1A1A1A]">{formatEur(payload[0].value)}</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OrdersTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-xl px-4 py-3 shadow-md text-sm font-[family-name:var(--font-roboto)]">
      <p className="font-semibold text-[#1A1A1A] mb-1">{label}</p>
      <p className="text-[#1A1A1A]">{payload[0].value} commande{payload[0].value !== 1 ? "s" : ""}</p>
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
    <div className="space-y-6">
      {/* Row 1 — Area + Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue AreaChart */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm mb-4">
            Revenus sur 6 mois
          </p>
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
        </div>

        {/* Orders BarChart */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm mb-4">
            Commandes sur 6 mois
          </p>
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
        </div>
      </div>

      {/* Row 2 — Pie + Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status PieChart */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm mb-4">
            Distribution des statuts
          </p>
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
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
        </div>

        {/* Top 5 products — horizontal bars */}
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm mb-4">
            Top 5 produits commandés
          </p>
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-[180px] text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
              Aucune donnée
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              {topProducts.map((product, i) => {
                const pct = maxQty > 0 ? Math.round((product.qty / maxQty) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A] font-medium truncate max-w-[75%]">
                        {product.name}
                      </span>
                      <span className="text-xs font-[family-name:var(--font-roboto)] text-[#6B7280] shrink-0 ml-2">
                        {product.qty} unité{product.qty !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="w-full bg-[#F0F0F0] rounded-full h-2">
                      <div
                        className="bg-[#1A1A1A] h-2 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
