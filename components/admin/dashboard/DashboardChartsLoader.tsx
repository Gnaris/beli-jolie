"use client";
import dynamic from "next/dynamic";
import type { MonthlyPoint, StatusPoint, TopProduct } from "./DashboardCharts";

const SKELETON_STRIPES = [
  "from-emerald-400 to-emerald-600",
  "from-sky-400 to-sky-600",
  "from-amber-400 to-amber-600",
  "from-violet-400 to-violet-600",
];

const DashboardCharts = dynamic(() => import("./DashboardCharts"), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {SKELETON_STRIPES.map((stripe, i) => (
        <div key={i} className="relative overflow-hidden bg-bg-primary border border-border rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm h-[280px]">
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${stripe}`} />
          <div className="h-3 w-1/3 rounded bg-bg-secondary animate-pulse mb-3 mt-1" />
          <div className="h-4 w-1/2 rounded bg-bg-secondary animate-pulse mb-6" />
          <div className="h-[180px] rounded bg-bg-secondary/60 animate-pulse" />
        </div>
      ))}
    </div>
  ),
});

interface Props {
  monthlyData: MonthlyPoint[];
  statusDist: StatusPoint[];
  topProducts: TopProduct[];
}

export default function DashboardChartsLoader({ monthlyData, statusDist, topProducts }: Props) {
  return <DashboardCharts monthlyData={monthlyData} statusDist={statusDist} topProducts={topProducts} />;
}
