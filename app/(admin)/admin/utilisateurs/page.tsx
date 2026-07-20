import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOnline, getOnlineThreshold } from "@/lib/online-status";
import { initialsOf, avatarGradientFor } from "@/lib/user-avatar";
import AutoRefresh from "@/components/admin/users/AutoRefresh";
import UsersTabs from "@/components/admin/users/UsersTabs";
import AdminCardsPane from "@/components/admin/users/AdminCardsPane";
import Pagination from "@/components/ui/Pagination";
import PerPageSelect from "@/components/ui/PerPageSelect";
import type { UserStatus, Prisma } from "@prisma/client";

// Bypass cache : on veut le lastSeenAt frais à chaque rafraîchissement
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gestion des clients — Admin",
};

const PER_PAGE_CHOICES = [20, 50, 100, 200, 500];
const DEFAULT_PER_PAGE = 20;

function formatTimeAgo(date: Date | null): string {
  if (!date) return "Jamais";
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `Il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Il y a ${days}j`;
  const months = Math.floor(days / 30);
  return `Il y a ${months} mois`;
}

function formatShortDate(date: Date): { date: string; time: string } {
  return {
    date: new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    time: new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function parsePerPage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PER_PAGE;
  return PER_PAGE_CHOICES.includes(n) ? n : DEFAULT_PER_PAGE;
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// ─── Tuile KPI ─────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, icon, accent, pulse = false,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  accent: "neutral" | "emerald" | "amber" | "sky" | "violet";
  pulse?: boolean;
}) {
  const accentMap = {
    neutral: {
      cardBg: "bg-bg-primary",
      iconBg: "bg-bg-secondary border border-border", iconText: "text-text-primary",
      border: "border-border", valueText: "text-text-primary",
      glow: "before:bg-slate-300/25",
      labelText: "text-text-muted",
    },
    emerald: {
      cardBg: "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary",
      iconBg: "bg-emerald-100 border border-emerald-200", iconText: "text-emerald-700",
      border: "border-emerald-200/70", valueText: "text-emerald-700",
      glow: "before:bg-emerald-300/40",
      labelText: "text-emerald-700",
    },
    amber: {
      cardBg: "bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary",
      iconBg: "bg-amber-100 border border-amber-200", iconText: "text-amber-700",
      border: "border-amber-200/70", valueText: "text-amber-700",
      glow: "before:bg-amber-300/40",
      labelText: "text-amber-700",
    },
    sky: {
      cardBg: "bg-gradient-to-br from-sky-50 via-bg-primary to-bg-primary",
      iconBg: "bg-sky-100 border border-sky-200", iconText: "text-sky-700",
      border: "border-sky-200/70", valueText: "text-sky-700",
      glow: "before:bg-sky-300/40",
      labelText: "text-sky-700",
    },
    violet: {
      cardBg: "bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary",
      iconBg: "bg-violet-100 border border-violet-200", iconText: "text-violet-700",
      border: "border-violet-200/70", valueText: "text-violet-700",
      glow: "before:bg-violet-300/40",
      labelText: "text-violet-700",
    },
  }[accent];

  return (
    <div className={`relative overflow-hidden border ${accentMap.border} ${accentMap.cardBg} rounded-2xl p-4 sm:p-5 shadow-sm before:content-[''] before:absolute before:-top-10 before:-right-10 before:w-28 before:h-28 before:rounded-full before:blur-3xl ${accentMap.glow}`}>
      <div className="relative flex items-start justify-between mb-3">
        <p className={`text-[10px] sm:text-[11px] font-body font-bold uppercase tracking-[0.14em] ${accentMap.labelText}`}>{label}</p>
        <span className={`inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${accentMap.iconBg} ${accentMap.iconText}`}>
          {icon}
        </span>
      </div>
      <p className={`relative font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none flex items-center gap-2 ${accentMap.valueText}`}>
        {pulse && value > 0 && (
          <span className="relative inline-flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </span>
        )}
        {value}
      </p>
      <p className="relative text-[11px] sm:text-xs font-body text-text-muted mt-1.5">{sub}</p>
    </div>
  );
}

const FILTERS: { value: string; label: string }[] = [
  { value: "ALL",      label: "Tous" },
  { value: "PENDING",  label: "En attente" },
  { value: "APPROVED", label: "Approuvés" },
  { value: "REJECTED", label: "Rejetés" },
];

export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    tab?: string;
    page?: string;
    per?: string;
    mp?: string;
    q?: string;
  }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const params = await searchParams;
  const currentTab: "inscrits" | "fiches" = params.tab === "fiches" ? "fiches" : "inscrits";
  const filterStatus = params.status || "ALL";
  const perPage = parsePerPage(params.per);
  const page = parsePage(params.page);

  const onlineThreshold = getOnlineThreshold();

  // Common counters (KPI + tab badges)
  const [pendingCount, approvedCount, rejectedCount, totalCount, onlineCount, cardsTotalCount] =
    await Promise.all([
      prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "REJECTED" } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { role: "CLIENT", lastSeenAt: { gte: onlineThreshold } } }),
      prisma.adminClientCard.count({}),
    ]);

  const registeredWhere =
    filterStatus === "ALL"
      ? { role: "CLIENT" as const }
      : { role: "CLIENT" as const, status: filterStatus as UserStatus };

  const filteredRegisteredCount =
    filterStatus === "ALL"
      ? totalCount
      : filterStatus === "PENDING"
      ? pendingCount
      : filterStatus === "APPROVED"
      ? approvedCount
      : rejectedCount;

  const counts: Record<string, number> = {
    ALL:      totalCount,
    PENDING:  pendingCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };

  // Data loading depends on active tab
  const [clients, cardsData] = await Promise.all([
    currentTab === "inscrits"
      ? prisma.user.findMany({
          where: registeredWhere,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * perPage,
          take: perPage,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            email: true,
            phone: true,
            siret: true,
            status: true,
            lastLoginAt: true,
            lastSeenAt: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    currentTab === "fiches" ? loadAdminCards(params, page, perPage) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={10_000} />

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full blur-3xl bg-amber-200/25 pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-72 h-72 rounded-full blur-3xl bg-slate-200/50 pointer-events-none" />
        <div className="absolute -top-10 left-10 w-40 h-40 rounded-full blur-3xl bg-sky-200/25 pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Clients pro
              </span>
              <h1 className="page-title mt-4">Gestion des clients</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Comptes professionnels inscrits sur le site + votre répertoire personnel de fiches clients.
              </p>
            </div>
          </div>

          <div className="relative mt-6 sm:mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Total clients"
              value={totalCount}
              sub="Comptes enregistrés"
              accent="neutral"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              }
            />
            <KpiTile
              label="En ligne maintenant"
              value={onlineCount}
              sub="Actifs dans la dernière minute"
              accent="emerald"
              pulse
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
                </svg>
              }
            />
            <KpiTile
              label="À valider"
              value={pendingCount}
              sub="Nouvelles inscriptions"
              accent="amber"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                </svg>
              }
            />
            <KpiTile
              label="Mes fiches"
              value={cardsTotalCount}
              sub="Répertoire personnel admin"
              accent="violet"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              }
            />
          </div>
        </div>
      </section>

      <UsersTabs currentTab={currentTab} registeredCount={totalCount} cardsCount={cardsTotalCount} />

      {currentTab === "inscrits" ? (
        <RegisteredPane
          clients={clients}
          filterStatus={filterStatus}
          counts={counts}
          totalFiltered={filteredRegisteredCount}
          page={page}
          perPage={perPage}
        />
      ) : (
        cardsData && (
          <AdminCardsPane
            cards={cardsData.cards}
            totalCount={cardsData.filteredCount}
            filterCounts={cardsData.filterCounts}
            currentFilter={cardsData.filter}
            currentPage={page}
            perPage={perPage}
            search={cardsData.search}
          />
        )
      )}

      <p className="text-center text-[11px] text-text-muted font-body pt-2">
        Actualisation automatique toutes les 10 secondes
      </p>
    </div>
  );
}

// ─── Registered users pane (existing behaviour + pagination) ────────────────

type RegisteredClient = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  status: UserStatus;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

function RegisteredPane({
  clients,
  filterStatus,
  counts,
  totalFiltered,
  page,
  perPage,
}: {
  clients: RegisteredClient[];
  filterStatus: string;
  counts: Record<string, number>;
  totalFiltered: number;
  page: number;
  perPage: number;
}) {
  return (
    <>
      {/* Filtres + par page */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => {
            const isActive = filterStatus === filter.value;
            const count = counts[filter.value];
            const isPendingChip = filter.value === "PENDING";
            const isRejectedChip = filter.value === "REJECTED";

            let chipClass = "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary";
            let countClass = "bg-bg-secondary text-text-muted";

            if (isActive) {
              if (isPendingChip) {
                chipClass = "bg-gradient-to-br from-amber-600 to-amber-700 border-amber-600 text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              } else if (isRejectedChip) {
                chipClass = "bg-gradient-to-br from-red-600 to-red-700 border-red-600 text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              } else {
                chipClass = "bg-gradient-to-br from-text-primary to-text-secondary border-text-primary text-white shadow-sm";
                countClass = "bg-white/20 text-white";
              }
            } else if (isPendingChip && count > 0) {
              chipClass = "bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-300";
              countClass = "bg-amber-100 text-amber-800";
            }

            return (
              <Link
                key={filter.value}
                href={filter.value === "ALL" ? "/admin/utilisateurs" : `/admin/utilisateurs?status=${filter.value}`}
                prefetch={false}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${chipClass}`}
              >
                {filter.label}
                <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold ${countClass}`}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <PerPageSelect value={perPage} />
      </div>

      {/* Liste */}
      {clients.length === 0 ? (
        <div className="bg-bg-primary rounded-2xl border border-border shadow-sm py-16 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-5 bg-bg-secondary border border-border">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-text-muted">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
            </svg>
          </div>
          <h3 className="font-heading text-xl font-bold text-text-primary mb-2">Aucun client trouvé</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {filterStatus === "ALL"
              ? "Vous n'avez encore aucun client inscrit."
              : `Aucun client avec le statut « ${FILTERS.find(f => f.value === filterStatus)?.label ?? ""} » pour l'instant.`}
          </p>
          {filterStatus !== "ALL" && (
            <Link href="/admin/utilisateurs" className="btn-ghost mt-6 inline-flex">
              ← Voir tous les clients
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden lg:block bg-bg-primary rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Client</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Société · Email</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">SIRET</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Statut</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Présence</th>
                    <th className="px-5 py-3 text-left text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Inscription</th>
                    <th className="px-5 py-3 text-right text-[11px] font-body font-bold text-text-muted uppercase tracking-[0.12em] whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const online = isOnline(c.lastSeenAt);
                    const isPending = c.status === "PENDING";
                    const isRejected = c.status === "REJECTED";
                    const inscription = formatShortDate(c.createdAt);
                    const gradient = avatarGradientFor(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border last:border-0 transition-colors hover:bg-bg-secondary/60 ${
                          isPending ? "bg-gradient-to-r from-amber-50/70 to-transparent" : ""
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`relative flex items-center justify-center w-10 h-10 rounded-xl text-white text-[13px] font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                              {initialsOf(c.firstName, c.lastName)}
                              {online && (
                                <span className="absolute -right-0.5 -bottom-0.5 flex w-3 h-3">
                                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                                  <span className="relative w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-bg-primary" />
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-body font-semibold text-text-primary truncate">
                                {c.firstName} {c.lastName}
                              </p>
                              {isPending
                                ? <p className="text-[11.5px] font-body font-medium text-amber-700">Nouvelle demande</p>
                                : isRejected
                                  ? <p className="text-[11.5px] font-body text-text-muted">Compte refusé</p>
                                  : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 min-w-0">
                          <p className="text-[13.5px] font-body font-medium text-text-primary truncate max-w-xs">
                            {c.company}
                          </p>
                          <p className="text-xs font-body text-text-muted truncate max-w-xs">
                            {c.email}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className="font-mono text-[12.5px] text-text-secondary tabular-nums">{c.siret || "—"}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`badge ${
                            c.status === "APPROVED" ? "badge-success" :
                            c.status === "PENDING" ? "badge-warning" :
                            "badge-error"
                          }`}>
                            {c.status === "APPROVED" ? "Approuvé" :
                             c.status === "PENDING" ? "En attente" :
                             "Rejeté"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {online ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-body font-medium text-emerald-700">
                              <span className="relative inline-flex w-2 h-2">
                                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                                <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                              </span>
                              En ligne
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-muted">
                              <span className="w-2 h-2 rounded-full bg-text-muted/40" />
                              Hors ligne
                            </span>
                          )}
                          <p className={`text-[11px] font-body mt-0.5 ${online ? "text-text-secondary" : "text-text-muted"}`}>
                            {formatTimeAgo(c.lastLoginAt)}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className="text-xs font-body text-text-secondary">{inscription.date}</p>
                          <p className="text-[11px] font-body text-text-muted">{inscription.time}</p>
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          {isPending ? (
                            <Link
                              href={`/admin/utilisateurs/${c.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-text-primary to-text-secondary text-white text-xs font-body font-semibold shadow-sm hover:opacity-90 transition-opacity"
                            >
                              Examiner
                            </Link>
                          ) : (
                            <Link
                              href={`/admin/utilisateurs/${c.id}`}
                              className="inline-flex items-center gap-1 text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors"
                            >
                              Voir
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14M13 5l7 7-7 7"/>
                              </svg>
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-2.5">
            {clients.map((c) => {
              const online = isOnline(c.lastSeenAt);
              const isPending = c.status === "PENDING";
              const isRejected = c.status === "REJECTED";
              const gradient = avatarGradientFor(c.id);
              return (
                <Link
                  key={c.id}
                  href={`/admin/utilisateurs/${c.id}`}
                  className={`block rounded-2xl border p-4 shadow-sm transition-colors ${
                    isPending
                      ? "border-amber-200 bg-gradient-to-br from-amber-50 to-bg-primary"
                      : "border-border bg-bg-primary hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`relative flex items-center justify-center w-11 h-11 rounded-xl text-white text-sm font-heading font-bold shadow-sm shrink-0 ${gradient}`}>
                      {initialsOf(c.firstName, c.lastName)}
                      {online && (
                        <span className="absolute -right-0.5 -bottom-0.5 flex w-3 h-3">
                          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                          <span className="relative w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-bg-primary" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-body font-semibold text-text-primary truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-[12px] font-body text-text-muted truncate">{c.company}</p>
                        </div>
                        <span className={`badge ${
                          c.status === "APPROVED" ? "badge-success" :
                          c.status === "PENDING" ? "badge-warning" :
                          "badge-error"
                        } shrink-0`}>
                          {c.status === "APPROVED" ? "Approuvé" :
                           c.status === "PENDING" ? "En attente" :
                           "Rejeté"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11.5px] font-body">
                        {online ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                            <span className="relative inline-flex w-2 h-2">
                              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
                              <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                            </span>
                            En ligne · {formatTimeAgo(c.lastLoginAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-text-muted">
                            <span className="w-2 h-2 rounded-full bg-text-muted/40" />
                            {isRejected ? "Refusé" : `Hors ligne · ${formatTimeAgo(c.lastLoginAt)}`}
                          </span>
                        )}
                        <span className="text-text-muted">
                          {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                      {isPending && (
                        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-text-primary to-text-secondary text-white text-[12px] font-body font-semibold">
                          Examiner la demande
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M13 5l7 7-7 7"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            <div className="bg-bg-primary rounded-2xl border border-border overflow-hidden">
              <Pagination totalItems={totalFiltered} perPage={perPage} currentPage={page} itemLabel="clients" />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Admin cards data loader ────────────────────────────────────────────────

async function loadAdminCards(
  params: { mp?: string; q?: string },
  page: number,
  perPage: number,
) {
  const filter = (["PFS", "ANKORSTORE", "EFASHION", "FAIRE", "MICROSTORE", "PASSAGE"] as const).includes(params.mp as never)
    ? (params.mp as "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE" | "MICROSTORE" | "PASSAGE")
    : ("ALL" as const);
  const q = (params.q ?? "").trim();

  const marketplaceFilter: Prisma.AdminClientCardWhereInput =
    filter === "PFS"
      ? { hasPfs: true }
      : filter === "ANKORSTORE"
      ? { hasAnkorstore: true }
      : filter === "EFASHION"
      ? { hasEfashion: true }
      : filter === "FAIRE"
      ? { hasFaire: true }
      : filter === "MICROSTORE"
      ? { hasMicrostore: true }
      : filter === "PASSAGE"
      ? { hasPassage: true }
      : {};

  const searchFilter: Prisma.AdminClientCardWhereInput = q
    ? {
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { company: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : {};

  const where: Prisma.AdminClientCardWhereInput = { AND: [marketplaceFilter, searchFilter] };

  const [
    cards,
    filteredCount,
    all,
    pfs,
    ankorstore,
    efashion,
    faire,
    microstore,
    passage,
  ] = await Promise.all([
    prisma.adminClientCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.adminClientCard.count({ where }),
    prisma.adminClientCard.count({ where: searchFilter }),
    prisma.adminClientCard.count({ where: { AND: [{ hasPfs: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasAnkorstore: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasEfashion: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasFaire: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasMicrostore: true }, searchFilter] } }),
    prisma.adminClientCard.count({ where: { AND: [{ hasPassage: true }, searchFilter] } }),
  ]);

  return {
    cards: cards.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      siret: c.siret,
      vatNumber: c.vatNumber,
      email: c.email,
      phone: c.phone,
      website: c.website,
      addressLine: c.addressLine ?? c.address, // Fallback : legacy address si nouveau champ vide
      postalCode: c.postalCode,
      city: c.city,
      countryCode: c.countryCode,
      hasPfs: c.hasPfs,
      hasAnkorstore: c.hasAnkorstore,
      hasEfashion: c.hasEfashion,
      hasFaire: c.hasFaire,
      hasMicrostore: c.hasMicrostore,
      hasPassage: c.hasPassage,
      lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
      lastMessageSentAt: c.lastMessageSentAt?.toISOString() ?? null,
      orderDiscountType: c.orderDiscountType,
      orderDiscountValue: c.orderDiscountValue ? c.orderDiscountValue.toString() : null,
      shippingFree: c.shippingFree,
      shippingDiscountType: c.shippingDiscountType,
      shippingDiscountValue: c.shippingDiscountValue ? c.shippingDiscountValue.toString() : null,
      note: c.note,
      pfsCustomerId: c.pfsCustomerId,
      importedFromMarketplace: c.importedFromMarketplace,
    })),
    filteredCount,
    filter,
    filterCounts: {
      ALL: all,
      PFS: pfs,
      ANKORSTORE: ankorstore,
      EFASHION: efashion,
      FAIRE: faire,
      MICROSTORE: microstore,
      PASSAGE: passage,
    },
    search: q,
  };
}
