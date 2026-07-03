import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getAdminClaims, getAdminClaimsStats } from "@/app/actions/admin/claims";
import AdminClaimsList from "./AdminClaimsList";

export const metadata = { title: "Service Client — Admin" };

const nfShort = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export default async function AdminClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const [claims, stats] = await Promise.all([getAdminClaims(), getAdminClaimsStats()]);

  const kpiInProgressHint = (() => {
    const returnPending =
      (stats.countMap.RETURN_PENDING ?? 0) + (stats.countMap.RETURN_SHIPPED ?? 0);
    if (returnPending > 0) {
      return `${returnPending} attend${returnPending > 1 ? "ent" : ""} un retour colis`;
    }
    const resolution = stats.countMap.RESOLUTION_PENDING ?? 0;
    if (resolution > 0) {
      return `${resolution} en résolution`;
    }
    return "Aucune demande en cours";
  })();

  const kpiToTreatHint =
    stats.toTreat === 0
      ? "Aucune demande à traiter"
      : stats.oldestOpenDays === null
      ? ""
      : stats.oldestOpenDays === 0
      ? "La plus ancienne : aujourd'hui"
      : `La plus ancienne : il y a ${stats.oldestOpenDays} jour${stats.oldestOpenDays > 1 ? "s" : ""}`;

  const kpiResolvedHint =
    stats.growth === null
      ? stats.resolvedThisMonth === 0
        ? "Aucune résolution ce mois"
        : "Premier mois d'activité"
      : stats.growth === 0
      ? "Stable / mois précédent"
      : `${stats.growth > 0 ? "↗" : "↘"} ${Math.abs(stats.growth).toFixed(0)} % vs mois précédent`;

  const kpiAmountHint =
    stats.monthResolvedCount === 0
      ? "Aucun montant ce mois"
      : `Sur ${stats.monthResolvedCount} dossier${stats.monthResolvedCount > 1 ? "s" : ""}`;

  return (
    <div className="space-y-5 md:space-y-6">
      {/* ── HERO ── */}
      <section
        className="relative rounded-3xl border border-border p-5 sm:p-6 md:p-8 overflow-hidden"
        style={{
          background: `
            radial-gradient(60% 80% at 12% 10%, rgba(24,24,27,0.06), transparent 60%),
            radial-gradient(50% 70% at 92% 20%, rgba(63,63,70,0.05), transparent 60%),
            radial-gradient(70% 90% at 60% 100%, rgba(24,24,27,0.04), transparent 60%),
            linear-gradient(180deg, #F5F3EE 0%, var(--color-bg-primary) 60%, var(--color-bg-primary) 100%)
          `,
        }}
      >
        <div
          className="absolute -top-16 -right-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "rgba(24,24,27,0.08)", filter: "blur(48px)" }}
        />
        <div
          className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "rgba(63,63,70,0.06)", filter: "blur(48px)" }}
        />

        <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-text-muted mb-3">
              <span>Admin</span>
              <span className="opacity-40">/</span>
              <span className="text-text-secondary">Service Client</span>
            </div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur border border-border text-[10.5px] sm:text-[11px] font-bold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-text-primary">
              <span
                className="w-1.5 h-1.5 rounded-full bg-text-primary"
                style={{ boxShadow: "0 0 0 3px rgba(24,24,27,0.14)" }}
              />
              Support · Réclamations
            </span>
            <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mt-3">
              Service Client
            </h1>
            <p className="text-sm sm:text-[15px] text-text-secondary mt-1.5 max-w-xl">
              Suivez les réclamations, répondez à vos clientes et clôturez les dossiers en un endroit.
            </p>
          </div>
        </div>
      </section>

      {/* ── KPI TILES ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          icon={
            <path
              strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          }
          label="À traiter"
          value={stats.toTreat}
          suffix="demandes"
          hint={kpiToTreatHint}
        />
        <KpiTile
          icon={
            <path
              strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          }
          label="En cours"
          value={stats.inProgress}
          suffix="en examen"
          hint={kpiInProgressHint}
        />
        <KpiTile
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M5 13l4 4L19 7" />}
          label="Résolues · mois"
          value={stats.resolvedThisMonth}
          suffix="dossiers"
          hint={kpiResolvedHint}
        />
        <KpiTile
          icon={
            <path
              strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1"
            />
          }
          label="Avoirs émis"
          value={nfShort.format(Math.round(stats.monthAmount))}
          suffix="€ ce mois"
          hint={kpiAmountHint}
        />
      </section>

      <AdminClaimsList
        initialClaims={claims}
        totalAll={stats.total}
        countMap={stats.countMap}
      />
    </div>
  );
}

function KpiTile({
  icon, label, value, suffix, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div
      className="relative rounded-2xl border border-border p-4 sm:p-5 overflow-hidden"
      style={{
        background: "linear-gradient(140deg, #F5F3EE 0%, var(--color-bg-primary) 55%, var(--color-bg-primary) 100%)",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
      />
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none"
        style={{ background: "rgba(24,24,27,0.06)", filter: "blur(48px)" }}
      />
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-zinc-100 ring-1 ring-zinc-200 flex items-center justify-center text-zinc-800 shrink-0">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.12em] sm:tracking-[0.14em] uppercase text-zinc-700 truncate">
          {label}
        </span>
      </div>
      <div className="mt-3 sm:mt-4 flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
        <span className="text-2xl sm:text-3xl font-bold text-zinc-900 tabular-nums">{value}</span>
        {suffix && <span className="text-[11px] sm:text-xs text-text-muted">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] sm:text-[11.5px] text-text-muted mt-1">{hint}</p>}
    </div>
  );
}
