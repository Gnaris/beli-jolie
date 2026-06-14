import type { VisitStatsBundle, PeriodVisitStats } from "@/lib/visit-stats";

interface Props {
  stats: VisitStatsBundle;
}

export default function VisitorStats({ stats }: Props) {
  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ── Aujourd'hui : 3 tuiles brandées ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <TodayCard
          label="Connectés"
          value={stats.today.authenticated}
          accent={{
            cardBg: "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary",
            border: "border-emerald-200",
            iconBg: "bg-emerald-100 ring-1 ring-emerald-200",
            iconText: "text-emerald-700",
            labelText: "text-emerald-700",
            valueText: "text-emerald-700",
            halo: "before:bg-emerald-300/40",
          }}
          hint="Comptes clients identifiés aujourd'hui"
        />
        <TodayCard
          label="Anonymes"
          value={stats.today.anonymous}
          accent={{
            cardBg: "bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary",
            border: "border-violet-200",
            iconBg: "bg-violet-100 ring-1 ring-violet-200",
            iconText: "text-violet-700",
            labelText: "text-violet-700",
            valueText: "text-violet-700",
            halo: "before:bg-violet-300/40",
          }}
          hint="Visiteurs sans connexion (cookie unique)"
        />
        <TodayCard
          label="Total visiteurs"
          value={stats.today.total}
          accent={{
            cardBg: "bg-gradient-to-br from-bg-dark via-[#2A2A2D] to-[#1A1A1A]",
            border: "border-bg-dark",
            iconBg: "bg-white/10 ring-1 ring-white/20 backdrop-blur-sm",
            iconText: "text-amber-300",
            labelText: "text-white/70",
            valueText: "text-white",
            halo: "before:bg-amber-400/20",
          }}
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
              <th className="px-5 py-3 text-left font-body font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Période</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Connectés</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Anonymes</th>
              <th className="px-5 py-3 text-right font-body font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Total</th>
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

interface TodayAccent {
  cardBg: string;
  border: string;
  iconBg: string;
  iconText: string;
  labelText: string;
  valueText: string;
  halo: string;
}

function TodayCard({
  label, value, accent, hint, dark = false,
}: {
  label: string;
  value: number;
  accent: TodayAccent;
  hint: string;
  dark?: boolean;
}) {
  const haloBefore = `before:content-[''] before:absolute before:-top-12 before:-right-12 before:w-32 before:h-32 before:rounded-full before:blur-3xl ${accent.halo}`;
  return (
    <div className={`relative overflow-hidden ${accent.cardBg} border ${accent.border} rounded-2xl p-4 sm:p-5 shadow-sm ${haloBefore}`}>
      <div className="relative flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${accent.iconBg} ${accent.iconText}`}>
          <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <p className={`text-[10px] sm:text-[11px] font-body uppercase tracking-wider font-semibold ${accent.labelText}`}>
          {label} · aujourd&apos;hui
        </p>
      </div>
      <p className={`relative font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none ${accent.valueText}`}>{value}</p>
      <p className={`relative text-[11px] font-body mt-1.5 sm:mt-2 ${dark ? "text-white/60" : "text-text-muted"}`}>{hint}</p>
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
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="font-body text-text-muted">Connectés</span>
          <span className="font-body font-semibold text-text-secondary tabular-nums ml-auto">{stats.authenticated}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
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
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {stats.authenticated}
        </span>
      </td>
      <td className="px-5 py-3.5 text-right font-body text-text-secondary tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          {stats.anonymous}
        </span>
      </td>
      <td className="px-5 py-3.5 text-right font-heading font-bold text-text-primary tabular-nums">{stats.total}</td>
    </tr>
  );
}
