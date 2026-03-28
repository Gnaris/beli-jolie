import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserStatus } from "@prisma/client";
import LiveClientsTracker from "@/components/admin/tracking/LiveClientsTracker";
import ClientsList from "@/components/admin/tracking/ClientsList";

export const metadata: Metadata = {
  title: "Gestion des clients — Admin",
};

/** Filtres disponibles avec leur label */
const FILTERS: { value: string; label: string }[] = [
  { value: "ALL",      label: "Tous" },
  { value: "ONLINE",   label: "En ligne" },
  { value: "PENDING",  label: "En attente" },
  { value: "APPROVED", label: "Approuvés" },
  { value: "REJECTED", label: "Rejetés" },
];

/** Threshold for "online" status: 2 minutes */
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Page liste des clients — /admin/utilisateurs
 *
 * Accepte un query param ?status= pour filtrer
 * Server Component : fetche directement Prisma
 */
export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { status, tab } = await searchParams;
  const isSuiviTab = tab === "suivi";
  const filterStatus = status || "ALL";

  const now = Date.now(); // eslint-disable-line react-compiler/react-compiler
  const onlineThreshold = new Date(now - ONLINE_THRESHOLD_MS);

  // Construction du filtre Prisma selon l'onglet actif
  const isOnlineFilter = filterStatus === "ONLINE";
  const whereClause = isOnlineFilter
    ? {
        role: "CLIENT" as const,
        activity: { lastSeenAt: { gte: onlineThreshold } },
      }
    : filterStatus === "ALL"
      ? { role: "CLIENT" as const }
      : { role: "CLIENT" as const, status: filterStatus as UserStatus };

  // Récupération des clients + comptages par statut
  const [clients, pendingCount, approvedCount, rejectedCount, totalCount, onlineCount] =
    await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          phone: true,
          siret: true,
          status: true,
          createdAt: true,
          activity: {
            select: {
              lastSeenAt: true,
              currentPage: true,
            },
          },
        },
      }),
      prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "REJECTED" } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({
        where: {
          role: "CLIENT",
          activity: { lastSeenAt: { gte: onlineThreshold } },
        },
      }),
    ]);

  const counts: Record<string, number> = {
    ALL:      totalCount,
    ONLINE:   onlineCount,
    PENDING:  pendingCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };

  return (
    <div className="space-y-6">

      {/* En-tete + stats */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Gestion des clients</h1>
          <p className="page-subtitle font-body">
            Gerez les comptes professionnels et validez les nouvelles inscriptions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="stat-card px-4 py-2 text-center">
            <p className="text-lg font-bold text-text-primary font-heading">{totalCount}</p>
            <p className="text-[10px] text-text-muted font-body uppercase tracking-wider">Total</p>
          </div>
          {pendingCount > 0 && (
            <div className="stat-card px-4 py-2 text-center border-warning/40">
              <p className="text-lg font-bold text-warning font-heading">{pendingCount}</p>
              <p className="text-[10px] text-text-muted font-body uppercase tracking-wider">En attente</p>
            </div>
          )}
        </div>
      </div>

      {/* Onglets principaux : Liste / Suivi en direct */}
      <div className="flex gap-1 bg-bg-secondary p-1 rounded-lg w-fit">
        <Link
          href="/admin/utilisateurs"
          prefetch={false}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-body font-medium rounded-md transition-all ${
            !isSuiviTab
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          Liste
        </Link>
        <Link
          href="/admin/utilisateurs?tab=suivi"
          prefetch={false}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-body font-medium rounded-md transition-all ${
            isSuiviTab
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          Suivi en direct
          {onlineCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5 font-medium tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {onlineCount}
            </span>
          )}
        </Link>
      </div>

      {isSuiviTab ? (
        <LiveClientsTracker />
      ) : (
      <>
      {/* Onglets filtre */}
      <div className="flex flex-wrap gap-1 bg-bg-secondary p-1 rounded-lg w-fit">
        {FILTERS.map((filter) => {
          const isActive = filterStatus === filter.value;
          const count = counts[filter.value];
          return (
            <Link
              key={filter.value}
              href={filter.value === "ALL"
                ? "/admin/utilisateurs"
                : `/admin/utilisateurs?status=${filter.value}`}
              prefetch={false}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-body font-medium rounded-md transition-all ${
                isActive
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {filter.label}
              {filter.value === "ONLINE" && count > 0 && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]" />
                </span>
              )}
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                filter.value === "PENDING" && count > 0
                  ? "bg-warning text-white"
                  : filter.value === "ONLINE" && count > 0
                    ? "bg-[#22C55E] text-white"
                    : isActive
                      ? "bg-bg-tertiary text-text-secondary"
                      : "text-text-muted"
              }`}>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Liste des clients — composant client avec statut en ligne temps réel via SSE */}
      <ClientsList
        clients={clients.map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          email: c.email,
          siret: c.siret,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          lastSeenAt: c.activity?.lastSeenAt?.toISOString() ?? null,
        }))}
      />
      </>
      )}
    </div>
  );
}
