import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getDashboardOverview,
  countryFlagEmoji,
  type TopCountry,
} from "@/lib/dashboard-overview";
import MonthlyRevenueChart from "@/components/admin/dashboard/MonthlyRevenueChart";

export const metadata: Metadata = {
  title: "Tableau de bord — Admin",
};

export const dynamic = "force-dynamic";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1).replace(".", ",")} %`;
}

/* ─────────────────────────────────────────────────────────────────
 * Dashboard admin — style V14 minimal moderne (refonte 2026-10-21)
 *
 * Layout en 3 rangées :
 *   1. Salutation « Bonjour, [prénom] »
 *   2. HÉRO bleu marine (col-7) : CA total XL · CTA blanc
 *      + Colonne droite (col-5) : CA du jour (blanc) empilé avec
 *        Visiteurs du jour (bleu pâle poudré)
 *   3. Top 3 pays (col-5, 1 pays accentué bleu pâle + 2 blanc) ·
 *      Graphique CA mensuel (col-7)
 *
 * Palette non-négociable : blanc, bleu marine #1E3A5F,
 * bleu pâle #E8EEF5, noir #18181B. Vert émeraude autorisé
 * uniquement pour les chips d'évolution positive.
 *
 * Les cartes aux fonds colorés custom (marine + bleu pâle)
 * portent `admin-fab-preserve` : les règles CSS globales de
 * dark mode ignorent ce bloc et le fond reste identique.
 * ─────────────────────────────────────────────────────────── */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const sp = await searchParams;
  const requestedYear = sp.annee ? parseInt(sp.annee, 10) : undefined;
  const yearParam = Number.isFinite(requestedYear) ? requestedYear : undefined;

  const data = await getDashboardOverview(yearParam);

  const firstName = session?.user.name?.split(" ")[0] ?? "Admin";

  const todayLabel = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5 md:space-y-6">
      {/* ─── Salutation ─────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-[28px] md:text-[32px] font-bold leading-tight tracking-tight text-text-primary">
            Bonjour,{" "}
            <span
              className="italic font-normal text-zinc-500"
              style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', serif" }}
            >
              {firstName}
            </span>
          </h1>
          <p className="text-[13px] font-body text-text-muted mt-1">
            Voici l&apos;activité de votre boutique aujourd&apos;hui.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-[11px] font-body font-semibold text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Mis à jour à l&apos;instant
        </span>
      </div>

      {/* ─── Ligne 1 : HÉRO marine + colonne droite empilée ──── */}
      <div className="grid grid-cols-12 gap-5">
        {/* HÉRO bleu marine — CA total */}
        <div
          className="admin-fab-preserve col-span-12 lg:col-span-7 rounded-[32px] p-7 md:p-8 min-h-[320px] text-white flex flex-col justify-between relative overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at 85% -10%, rgba(255,255,255,0.12), transparent 55%), radial-gradient(circle at -10% 110%, rgba(255,255,255,0.07), transparent 55%), #1E3A5F",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-body font-semibold uppercase tracking-[0.25em] opacity-70">
                Chiffre d&apos;affaires total
              </p>
              <p
                className="text-sm italic mt-1 opacity-80"
                style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', serif" }}
              >
                depuis l&apos;ouverture
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="font-heading text-[64px] md:text-[88px] font-bold leading-none tracking-tight tabular-nums">
              {formatMoney(data.totalRevenue)}
              <span className="text-[40px] md:text-[52px] opacity-70"> €</span>
            </p>
            <p className="text-[13px] font-body mt-4 opacity-80">
              {data.totalOrdersCount} commande{data.totalOrdersCount > 1 ? "s" : ""} au total
            </p>
          </div>

          <div className="mt-6 md:mt-8 flex items-center gap-3 flex-wrap">
            <a
              href="/admin/commandes"
              className="inline-flex items-center gap-2 bg-white text-zinc-900 rounded-full px-5 py-2.5 text-[13px] font-body font-semibold hover:-translate-y-0.5 transition-transform"
            >
              Voir les commandes
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </a>
          </div>
        </div>

        {/* Colonne droite : CA du jour + Visiteurs empilés */}
        <div className="col-span-12 lg:col-span-5 grid grid-rows-2 gap-5">
          {/* CA du jour — carte blanche */}
          <div className="bg-white rounded-[32px] p-6 md:p-7 flex flex-col justify-between min-h-[148px]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-body font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Aujourd&apos;hui
              </p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 text-[10.5px] font-body font-semibold text-zinc-500 tabular-nums">
                {todayLabel}
              </span>
            </div>
            <div>
              <p className="font-heading text-[40px] md:text-[48px] font-bold leading-none tracking-tight tabular-nums text-text-primary">
                {formatMoney(data.todayRevenue)}
                <span className="text-[24px] md:text-[28px] text-zinc-400"> €</span>
              </p>
              <p className="text-[12px] font-body text-text-muted mt-2">
                {data.todayOrdersCount} commande{data.todayOrdersCount > 1 ? "s" : ""} aujourd&apos;hui
              </p>
            </div>
          </div>

          {/* Visiteurs — carte bleu pâle poudré */}
          <div
            className="admin-fab-preserve rounded-[32px] p-6 md:p-7 min-h-[148px]"
            style={{ background: "#E8EEF5", color: "#1E3A5F" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-body font-semibold uppercase tracking-[0.22em] opacity-70">
                Visiteurs du jour
              </p>
              <span className="font-heading text-[32px] md:text-[36px] font-bold leading-none tabular-nums">
                {data.todayVisits.total}
              </span>
            </div>
            <div className="mt-5 md:mt-6 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10.5px] font-body font-semibold uppercase tracking-[0.18em] opacity-65">
                  Connectés
                </p>
                <p className="font-heading text-[20px] md:text-[22px] font-bold tabular-nums mt-1">
                  {data.todayVisits.authenticated}
                </p>
              </div>
              <div
                className="pl-4 border-l"
                style={{ borderColor: "rgba(30,58,95,0.25)" }}
              >
                <p className="text-[10.5px] font-body font-semibold uppercase tracking-[0.18em] opacity-65">
                  Anonymes
                </p>
                <p className="font-heading text-[20px] md:text-[22px] font-bold tabular-nums mt-1">
                  {data.todayVisits.anonymous}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Ligne 2 : Top 3 pays + Graphique CA mensuel ──────── */}
      <div className="grid grid-cols-12 gap-5">
        {/* Top 3 pays (empilé — #1 en accent bleu pâle) */}
        <div className="col-span-12 lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-body font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Top 3 pays
            </p>
            <span
              className="text-[10.5px] text-zinc-500 italic"
              style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', serif" }}
            >
              depuis le début
            </span>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => {
              const country: TopCountry | undefined = data.topCountries[i];
              if (!country) {
                return (
                  <div
                    key={`empty-${i}`}
                    className="rounded-[24px] border border-dashed border-zinc-300 bg-white/40 min-h-[86px] flex items-center justify-center"
                  >
                    <span className="text-[11px] font-body text-zinc-400">
                      Pas encore de données
                    </span>
                  </div>
                );
              }
              const flag = countryFlagEmoji(country.code);
              const isFirst = i === 0;

              if (isFirst) {
                return (
                  <div
                    key={country.code}
                    className="admin-fab-preserve rounded-[24px] p-5 flex items-center gap-4"
                    style={{ background: "#E8EEF5", color: "#1E3A5F" }}
                  >
                    <span className="text-[42px] leading-none">{flag || "🏳️"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-body font-semibold text-[14px] truncate">
                          {country.name}
                        </p>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full bg-white text-[10px] font-body font-bold shrink-0"
                          style={{ color: "#1E3A5F" }}
                        >
                          #1
                        </span>
                      </div>
                      <p className="font-heading text-[22px] md:text-[26px] font-bold mt-0.5 tabular-nums tracking-tight">
                        {formatMoney(country.amount)} €
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-heading text-[16px] md:text-[18px] font-bold tabular-nums">
                        {formatPercent(country.share)}
                      </p>
                      <p className="text-[10.5px] opacity-70">du CA</p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={country.code}
                  className="bg-white rounded-[24px] p-5 flex items-center gap-4"
                >
                  <span className="text-[36px] leading-none">{flag || "🏳️"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-body font-semibold text-[14px] text-text-primary truncate">
                        {country.name}
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-100 text-[10px] font-body font-bold text-zinc-600 shrink-0">
                        #{i + 1}
                      </span>
                    </div>
                    <p className="font-heading text-[20px] md:text-[22px] font-bold mt-0.5 tabular-nums tracking-tight text-text-primary">
                      {formatMoney(country.amount)} €
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-heading text-[14px] md:text-[15px] font-bold tabular-nums text-zinc-700">
                      {formatPercent(country.share)}
                    </p>
                    <p className="text-[10.5px] text-zinc-400">du CA</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Graphique CA mensuel */}
        <div className="col-span-12 lg:col-span-7">
          <MonthlyRevenueChart
            monthlyRevenue={data.monthlyRevenue}
            activeYear={data.activeYear}
            availableYears={data.availableYears}
          />
        </div>
      </div>
    </div>
  );
}
