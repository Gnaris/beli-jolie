import type { VisitStatsBundle, PeriodVisitStats } from "@/lib/visit-stats";

interface Props {
  stats: VisitStatsBundle;
}

export default function VisitorStats({ stats }: Props) {
  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ── Aujourd'hui : 3 tuiles Ardoise ──────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <TodayCard
          label="Connectés"
          value={stats.today.authenticated}
          hint="Comptes clients identifiés aujourd'hui"
          liveDot
        />
        <TodayCard
          label="Anonymes"
          value={stats.today.anonymous}
          hint="Visiteurs sans connexion (cookie unique)"
        />
        <TodayCard
          label="Total visiteurs"
          value={stats.today.total}
          hint="Total unique aujourd'hui"
          dark
        />
      </div>

      {/* ── Période : cards mobile, table desktop ───────────────────────── */}
      <div className="md:hidden space-y-2.5">
        <PeriodCard label="7 derniers jours" stats={stats.week} />
        <PeriodCard label="30 derniers jours" stats={stats.month} />
        <PeriodCard label="365 derniers jours" stats={stats.year} />
      </div>

      <div className="hidden md:block bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/60">
              <th className="px-5 py-3 text-left font-body font-semibold text-text-muted text-[11px] uppercase tracking-wider">Période</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-muted text-[11px] uppercase tracking-wider">Connectés</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-muted text-[11px] uppercase tracking-wider">Anonymes</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-muted text-[11px] uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            <Row label="7 derniers jours" stats={stats.week} />
            <Row label="30 derniers jours" stats={stats.month} />
            <Row label="365 derniers jours" stats={stats.year} />
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-muted font-body mt-1 leading-relaxed">
        Un même visiteur (connecté ou anonyme) n&apos;est compté qu&apos;une seule fois par jour.
        Les visiteurs anonymes sont identifiés via un cookie déposé sur leur navigateur.
      </p>
    </div>
  );
}

function TodayCard({
  label, value, hint, dark = false, liveDot = false,
}: {
  label: string;
  value: number;
  hint: string;
  dark?: boolean;
  liveDot?: boolean;
}) {
  const cardBg = dark
    ? "bg-bg-dark text-white border-bg-dark"
    : "bg-bg-primary border-border text-text-primary";
  const iconBox = dark ? "bg-white/10 text-white" : "bg-bg-tertiary text-text-primary";
  const labelColor = dark ? "text-white/60" : "text-text-muted";
  const hintColor = dark ? "text-white/60" : "text-text-muted";

  return (
    <div
      data-visitor-tile={dark ? "dark" : undefined}
      className={`relative overflow-hidden border rounded-2xl p-4 sm:p-5 shadow-sm ${cardBg}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          data-visitor-tile-icon={dark ? "dark" : undefined}
          className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${iconBox}`}
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <p className={`text-[10px] sm:text-[11px] font-body uppercase tracking-wider font-semibold flex items-center gap-1.5 ${labelColor}`}>
          {liveDot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          {label} · aujourd&apos;hui
        </p>
      </div>
      <p className="font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none">{value}</p>
      <p className={`text-[11px] font-body mt-1.5 sm:mt-2 ${hintColor}`}>{hint}</p>
    </div>
  );
}

function PeriodCard({ label, stats }: { label: string; stats: PeriodVisitStats }) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <p className="font-body font-semibold text-text-primary text-sm">{label}</p>
        <p className="font-heading text-xl font-bold text-text-primary tabular-nums">{stats.total}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-text-primary" />
          <span className="font-body text-text-muted">Connectés</span>
          <span className="font-body font-semibold text-text-secondary tabular-nums ml-auto">{stats.authenticated}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-border-strong" />
          <span className="font-body text-text-muted">Anonymes</span>
          <span className="font-body font-semibold text-text-secondary tabular-nums ml-auto">{stats.anonymous}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, stats }: { label: string; stats: PeriodVisitStats }) {
  return (
    <tr className="border-b border-border-light last:border-0 hover:bg-bg-secondary/40 transition-colors">
      <td className="px-5 py-3.5 font-body text-text-primary font-medium">{label}</td>
      <td className="px-5 py-3.5 text-right font-body text-text-secondary tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-text-primary" />
          {stats.authenticated}
        </span>
      </td>
      <td className="px-5 py-3.5 text-right font-body text-text-secondary tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-border-strong" />
          {stats.anonymous}
        </span>
      </td>
      <td className="px-5 py-3.5 text-right font-heading font-bold text-text-primary tabular-nums">{stats.total}</td>
    </tr>
  );
}
