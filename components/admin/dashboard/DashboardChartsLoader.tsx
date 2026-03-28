"use client";
import dynamic from "next/dynamic";
import type { MonthlyPoint, StatusPoint, TopProduct } from "./DashboardCharts";

const DashboardCharts = dynamic(() => import("./DashboardCharts"), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] h-[280px] animate-pulse" />
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
