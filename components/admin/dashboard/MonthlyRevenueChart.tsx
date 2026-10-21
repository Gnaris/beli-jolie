import type { MonthlyRevenuePoint } from "@/lib/dashboard-overview";
import DashboardYearSwitcher from "./DashboardYearSwitcher";

/**
 * Barres CA mensuel style V14 minimal :
 * - mois passés : noir (`#18181B`)
 * - mois actif  : bleu marine (`#1E3A5F`) + tooltip montant
 * - mois futurs : hachurés gris pâle (si année en cours)
 *
 * Composant serveur (lecture seule, pas d'interaction).
 */

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_SHORT = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];

function formatMoney(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

interface Props {
  monthlyRevenue: MonthlyRevenuePoint[];
  activeYear: number;
  availableYears: number[];
}

export default function MonthlyRevenueChart({
  monthlyRevenue,
  activeYear,
  availableYears,
}: Props) {
  const now = new Date();
  const currentMonthIdx = activeYear === now.getFullYear() ? now.getMonth() : -1;

  const maxMonthly = Math.max(1, ...monthlyRevenue.map((p) => p.amount));
  const avgMonthly = monthlyRevenue.reduce((s, p) => s + p.amount, 0) / 12;

  return (
    <div className="bg-white rounded-[32px] p-6 md:p-7">
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-body font-semibold uppercase tracking-[0.22em] text-zinc-500">
            CA mensuel
          </p>
          <p
            className="text-[11px] text-zinc-400 italic mt-1"
            style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', serif" }}
          >
            max {formatMoney(maxMonthly)} € · moyenne {formatMoney(avgMonthly)} €
          </p>
        </div>
        <DashboardYearSwitcher years={availableYears} active={activeYear} />
      </div>

      <div className="flex items-end gap-2 md:gap-2.5 h-[220px] md:h-[240px]">
        {monthlyRevenue.map((p, idx) => {
          const isCurrent = idx === currentMonthIdx;
          const isFuture = idx > currentMonthIdx && activeYear === now.getFullYear();
          const heightPct = isFuture
            ? 14
            : Math.max(4, (p.amount / maxMonthly) * 100);
          const barBg = isFuture ? "#F4F4F5" : isCurrent ? "#1E3A5F" : "#18181B";
          const labelColor = isFuture
            ? "#D4D4D8"
            : isCurrent
              ? "#1E3A5F"
              : "#A1A1AA";

          return (
            <div
              key={idx}
              className={`flex-1 flex flex-col items-center gap-2 ${isCurrent ? "relative" : ""}`}
            >
              {isCurrent && p.amount > 0 && (
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10.5px] font-body font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap">
                  {formatMoney(p.amount)} €
                  <span
                    aria-hidden
                    className="absolute left-1/2 -translate-x-1/2 -bottom-[3px] w-1.5 h-1.5 rotate-45 bg-zinc-900"
                  />
                </div>
              )}
              <div
                className="w-full rounded-xl transition-all duration-500 ease-out"
                style={{
                  height: `${heightPct}%`,
                  background: barBg,
                  border: isFuture ? "2px dashed #E4E4E7" : undefined,
                }}
                title={`${MONTH_SHORT[idx]} : ${formatMoney(p.amount)} €`}
              />
              <span
                className={`text-[10.5px] font-body ${isCurrent ? "font-semibold" : "font-medium"}`}
                style={{ color: labelColor }}
              >
                {MONTH_INITIALS[idx]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
