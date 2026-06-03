import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOnline, getOnlineThreshold } from "@/lib/online-status";
import AutoRefresh from "@/components/admin/users/AutoRefresh";
import type { UserStatus } from "@prisma/client";

// Bypass cache : on veut le lastSeenAt frais à chaque rafraîchissement
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gestion des clients — Admin",
};

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

/** Filtres disponibles avec leur label */
const FILTERS: { value: string; label: string }[] = [
  { value: "ALL",      label: "Tous" },
  { value: "PENDING",  label: "En attente" },
  { value: "APPROVED", label: "Approuvés" },
  { value: "REJECTED", label: "Rejetés" },
];

/**
 * Page liste des clients — /admin/utilisateurs
 *
 * Accepte un query param ?status= pour filtrer
 * Server Component : fetche directement Prisma
 */
export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { status } = await searchParams;
  const filterStatus = status || "ALL";

  // Construction du filtre Prisma
  const whereClause = filterStatus === "ALL"
    ? { role: "CLIENT" as const }
    : { role: "CLIENT" as const, status: filterStatus as UserStatus };

  // Seuil « en ligne maintenant » utilisé pour le compteur dédié
  const onlineThreshold = getOnlineThreshold();

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
          lastLoginAt: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "REJECTED" } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({
        where: { role: "CLIENT", lastSeenAt: { gte: onlineThreshold } },
      }),
    ]);

  const counts: Record<string, number> = {
    ALL:      totalCount,
    PENDING:  pendingCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={10_000} />

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
          <div className="stat-card px-4 py-2 text-center border-success/40">
            <div className="flex items-center justify-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${onlineCount > 0 ? "bg-success animate-pulse" : "bg-text-muted/40"}`} />
              <p className="text-lg font-bold text-success font-heading">{onlineCount}</p>
            </div>
            <p className="text-[10px] text-text-muted font-body uppercase tracking-wider">En ligne</p>
          </div>
          {pendingCount > 0 && (
            <div className="stat-card px-4 py-2 text-center border-warning/40">
              <p className="text-lg font-bold text-warning font-heading">{pendingCount}</p>
              <p className="text-[10px] text-text-muted font-body uppercase tracking-wider">En attente</p>
            </div>
          )}
        </div>
      </div>

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
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                filter.value === "PENDING" && count > 0
                  ? "bg-warning text-white"
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

      {/* Liste des clients */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border table-header">
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">Client</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">Société</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">Email</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">SIRET</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider">Statut</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">En ligne</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">Dernière connexion</th>
                <th className="px-5 py-3 text-left text-xs font-body font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">Inscription</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-text-secondary font-body text-sm">
                    Aucun client trouvé.
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg-secondary transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-body font-semibold text-text-primary text-sm">
                        {c.firstName} {c.lastName}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-body text-sm text-text-secondary">{c.company}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-body text-sm text-text-secondary">{c.email}</p>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className="font-mono text-sm text-text-secondary">{c.siret}</p>
                    </td>
                    <td className="px-5 py-4">
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
                    <td className="px-5 py-4 whitespace-nowrap">
                      {isOnline(c.lastSeenAt) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-body font-medium text-success">
                          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                          En ligne
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-body text-text-muted">
                          <span className="w-2 h-2 rounded-full bg-text-muted/40" />
                          Hors ligne
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className={`font-body text-xs ${c.lastLoginAt ? "text-text-secondary" : "text-text-muted"}`}>
                        {formatTimeAgo(c.lastLoginAt)}
                      </p>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <p className="font-body text-xs text-text-secondary">
                        {new Date(c.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <Link
                        href={`/admin/utilisateurs/${c.id}`}
                        className="text-sm text-text-secondary hover:text-text-primary font-body font-medium transition-colors underline underline-offset-2"
                      >
                        Voir
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
