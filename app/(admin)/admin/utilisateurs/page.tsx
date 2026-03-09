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
  PENDING:  { label: "En attente", className: "bg-amber-100 text-amber-700 border border-amber-200" },
  APPROVED: { label: "Approuvé",   className: "bg-emerald-100 text-emerald-700 border border-emerald-200" },
  REJECTED: { label: "Rejeté",     className: "bg-red-100 text-red-700 border border-red-200" },
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

      {/* En-tête */}
      <div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#0F172A]">
          Gestion des clients
        </h1>
        <p className="mt-1 text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
          Gérez les comptes professionnels et validez les nouvelles inscriptions.
        </p>
      </div>

      {/* Onglets filtre */}
      <div className="flex flex-wrap gap-2 border-b border-[#E2E8F0]">
        {FILTERS.map((filter) => {
          const isActive = filterStatus === filter.value;
          const count = counts[filter.value];
          return (
            <Link
              key={filter.value}
              href={filter.value === "ALL"
                ? "/admin/utilisateurs"
                : `/admin/utilisateurs?status=${filter.value}`}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-[family-name:var(--font-roboto)] font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-[#0F3460] text-[#0F172A]"
                  : "border-transparent text-[#475569] hover:text-[#0F172A]"
              }`}
            >
              {filter.label}
              {/* Badge avec le nombre */}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                filter.value === "PENDING" && count > 0
                  ? "bg-amber-500 text-white"
                  : "bg-[#F1F5F9] text-[#475569]"
              }`}>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Tableau des clients */}
      {clients.length === 0 ? (
        <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-12 text-center">
          <svg className="w-12 h-12 text-[#E2E8F0] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <p className="text-[#475569] font-[family-name:var(--font-roboto)]">
            Aucun client dans cette catégorie.
          </p>
        </div>
      ) : (
        <div className="bg-[#FFFFFF] border border-[#E2E8F0] overflow-hidden">

          {/* En-tête tableau — desktop uniquement */}
          <div className="hidden lg:grid grid-cols-[2fr_2fr_2fr_1.5fr_1fr_auto] gap-4 px-5 py-3 bg-[#F1F5F9] border-b border-[#E2E8F0]">
            {["Nom / Société", "Email", "SIRET", "Inscrit le", "Statut", ""].map((h) => (
              <span key={h} className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider">
                {h}
              </span>
            ))}
          </div>

          {/* Lignes */}
          {clients.map((client) => {
            const statusCfg = STATUS_CONFIG[client.status];
            const date = new Date(client.createdAt).toLocaleDateString("fr-FR", {
              day: "2-digit", month: "short", year: "numeric",
            });
            return (
              <div
                key={client.id}
                className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_2fr_1.5fr_1fr_auto] gap-3 lg:gap-4 px-5 py-4 border-b border-[#F1F5F9] last:border-0 items-center hover:bg-[#FFFFFF] transition-colors"
              >
                {/* Nom + Société */}
                <div>
                  <p className="font-[family-name:var(--font-roboto)] font-semibold text-[#0F172A] text-sm">
                    {client.firstName} {client.lastName}
                  </p>
                  <p className="text-xs text-[#475569] font-[family-name:var(--font-roboto)] mt-0.5">
                    {client.company}
                  </p>
                </div>

                {/* Email */}
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] truncate">
                  {client.email}
                </p>

                {/* SIRET */}
                <p className="text-sm font-mono text-[#475569]">
                  {client.siret}
                </p>

                {/* Date */}
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
                  {date}
                </p>

                {/* Badge statut */}
                <span className={`inline-flex items-center px-2.5 py-1 text-xs font-[family-name:var(--font-roboto)] font-semibold rounded-full w-fit ${statusCfg.className}`}>
                  {statusCfg.label}
                </span>

                {/* Actions */}
                <Link
                  href={`/admin/utilisateurs/${client.id}`}
                  className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#0F3460] border border-[#0F3460] px-3 py-1.5 hover:bg-[#0F3460] hover:text-[#FFFFFF] transition-colors whitespace-nowrap"
                >
                  Voir le dossier →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
