import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Gestion des clients — Admin",
};

/** Correspondance statut → libellé + styles */
const STATUS_CONFIG: Record<UserStatus, { label: string; className: string }> = {
  PENDING:  { label: "En attente", className: "badge-warning" },
  APPROVED: { label: "Approuvé",   className: "badge-success" },
  REJECTED: { label: "Rejeté",     className: "badge-error" },
};

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

  // Construction du filtre Prisma selon l'onglet actif
  const whereClause =
    filterStatus === "ALL"
      ? { role: "CLIENT" as const }
      : { role: "CLIENT" as const, status: filterStatus as UserStatus };

  // Récupération des clients + comptages par statut
  const [clients, pendingCount, approvedCount, rejectedCount, totalCount] =
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
        },
      }),
      prisma.user.count({ where: { role: "CLIENT", status: "PENDING" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "CLIENT", status: "REJECTED" } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
    ]);

  const counts: Record<string, number> = {
    ALL:      totalCount,
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
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            Gerez les comptes professionnels et validez les nouvelles inscriptions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="stat-card px-4 py-2 text-center">
            <p className="text-lg font-bold text-text-primary font-[family-name:var(--font-poppins)]">{totalCount}</p>
            <p className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)] uppercase tracking-wider">Total</p>
          </div>
          {pendingCount > 0 && (
            <div className="stat-card px-4 py-2 text-center border-warning/40">
              <p className="text-lg font-bold text-warning font-[family-name:var(--font-poppins)]">{pendingCount}</p>
              <p className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)] uppercase tracking-wider">En attente</p>
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
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-[family-name:var(--font-roboto)] font-medium rounded-md transition-all ${
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
      {clients.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary mb-1">Aucun client</p>
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
            Aucun client dans cette categorie.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => {
            const statusCfg = STATUS_CONFIG[client.status];
            const date = new Date(client.createdAt).toLocaleDateString("fr-FR", {
              day: "2-digit", month: "short", year: "numeric",
            });
            const initials = `${client.firstName[0] ?? ""}${client.lastName[0] ?? ""}`.toUpperCase();
            return (
              <Link
                key={client.id}
                href={`/admin/utilisateurs/${client.id}`}
                className="card card-hover block p-4 sm:p-5 group"
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    client.status === "PENDING"
                      ? "bg-[#FEF3C7]"
                      : client.status === "REJECTED"
                        ? "bg-[#FEE2E2]"
                        : "bg-bg-tertiary"
                  }`}>
                    <span className={`text-xs font-bold font-[family-name:var(--font-roboto)] ${
                      client.status === "PENDING"
                        ? "text-[#92400E]"
                        : client.status === "REJECTED"
                          ? "text-[#991B1B]"
                          : "text-text-secondary"
                    }`}>
                      {initials}
                    </span>
                  </div>

                  {/* Infos principales */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-[family-name:var(--font-roboto)] font-semibold text-text-primary text-sm group-hover:text-text-secondary transition-colors">
                        {client.firstName} {client.lastName}
                      </p>
                      <span className={`${statusCfg.className} text-[11px]`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] truncate mt-0.5">
                      {client.company}
                    </p>
                  </div>

                  {/* Details desktop */}
                  <div className="hidden md:flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] uppercase tracking-wider">Email</p>
                      <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)] truncate max-w-[200px]">{client.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] uppercase tracking-wider">SIRET</p>
                      <p className="text-sm text-text-secondary font-mono">{client.siret}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] uppercase tracking-wider">Inscrit le</p>
                      <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)]">{date}</p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>

                {/* Mobile details */}
                <div className="md:hidden flex flex-wrap gap-x-4 gap-y-1 mt-3 pl-14 text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                  <span>{client.email}</span>
                  <span>{date}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
