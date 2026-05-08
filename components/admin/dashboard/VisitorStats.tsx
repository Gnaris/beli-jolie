import type { VisitStatsBundle, PeriodVisitStats } from "@/lib/visit-stats";

interface Props {
  stats: VisitStatsBundle;
}

export default function VisitorStats({ stats }: Props) {
  return (
    <section>
      <h2 className="font-body text-xs uppercase tracking-wider text-text-muted mb-4">
        Visiteurs
      </h2>

      {/* Aujourd'hui — mis en avant */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <TodayCard label="Connectés" value={stats.today.authenticated} accent="#15803D" hint="Comptes clients identifiés aujourd'hui" />
        <TodayCard label="Anonymes" value={stats.today.anonymous} accent="#7C3AED" hint="Visiteurs sans connexion (cookie unique)" />
        <TodayCard label="Total" value={stats.today.total} accent="#1A1A1A" hint="Total des visiteurs uniques aujourd'hui" highlight />
      </div>

      {/* Tableau périodes */}
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="px-5 py-3 text-left font-body font-semibold text-text-secondary text-xs uppercase tracking-wider">
                Période
              </th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-xs uppercase tracking-wider">
                Connectés
              </th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-xs uppercase tracking-wider">
                Anonymes
              </th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-xs uppercase tracking-wider">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <Row label="7 derniers jours" stats={stats.week} />
            <Row label="30 derniers jours" stats={stats.month} />
            <Row label="365 derniers jours" stats={stats.year} />
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-muted font-body mt-3">
        Un même visiteur (connecté ou anonyme) n&apos;est compté qu&apos;une seule fois par jour.
        Les visiteurs anonymes sont identifiés via un cookie déposé sur leur navigateur.
      </p>
    </section>
  );
}

function TodayCard({
  label, value, accent, hint, highlight = false,
}: {
  label: string;
  value: number;
  accent: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-bg-primary border rounded-2xl p-5 shadow-sm ${highlight ? "border-2" : "border-border"}`} style={highlight ? { borderColor: accent } : undefined}>
      <div className="flex items-center gap-2 mb-3" style={{ color: accent }}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-[11px] font-body uppercase tracking-wider font-semibold">{label} — aujourd&apos;hui</p>
      </div>
      <p className="font-heading text-3xl font-bold text-text-primary tabular-nums">{value}</p>
      <p className="text-[11px] text-text-muted font-body mt-1">{hint}</p>
    </div>
  );
}

function Row({ label, stats }: { label: string; stats: PeriodVisitStats }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-bg-secondary/50 transition-colors">
      <td className="px-5 py-3.5 font-body text-text-primary font-medium">{label}</td>
      <td className="px-5 py-3.5 text-right font-body text-text-secondary tabular-nums">{stats.authenticated}</td>
      <td className="px-5 py-3.5 text-right font-body text-text-secondary tabular-nums">{stats.anonymous}</td>
      <td className="px-5 py-3.5 text-right font-heading font-bold text-text-primary tabular-nums">{stats.total}</td>
    </tr>
  );
}
