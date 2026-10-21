"use client";

import Link from "next/link";

interface Props {
  years: number[];
  active: number;
}

export default function DashboardYearSwitcher({ years, active }: Props) {
  return (
    <div className="flex items-center gap-1 bg-zinc-100 rounded-full p-1">
      {years.map((y) => {
        const isActive = y === active;
        return (
          <Link
            key={y}
            href={y === new Date().getFullYear() ? "/admin" : `/admin?annee=${y}`}
            scroll={false}
            className={`px-3 py-1.5 text-[11px] font-body font-semibold rounded-full transition-colors ${
              isActive
                ? "bg-white shadow-sm text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {y}
          </Link>
        );
      })}
    </div>
  );
}
