import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Tableau de bord — Admin",
};

/**
 * Page principale du panel administrateur
 *
 * Affiche :
 * - Statistiques globales (clients, commandes, comptes en attente)
 * - Liste des derniers comptes en attente de validation
 */
export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  // Récupération des statistiques en parallèle
  const [totalClients, pendingCount, approvedCount, rejectedCount, latestPending] =
    await Promise.all([
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { status: "PENDING" } }),
      prisma.user.count({ where: { status: "APPROVED", role: "CLIENT" } }),
      prisma.user.count({ where: { status: "REJECTED" } }),
      prisma.user.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          siret: true,
          createdAt: true,
        },
      }),
    ]);

  const stats = [
    {
      label: "Clients actifs",
      value: approvedCount,
      color: "text-text-primary",
      iconBg: "bg-bg-tertiary",
      iconColor: "text-text-secondary",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      ),
    },
    {
      label: "En attente",
      value: pendingCount,
      color: "text-warning",
      iconBg: "bg-[#FEF3C7]",
      iconColor: "text-warning",
      alert: pendingCount > 0,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: "Total inscrits",
      value: totalClients,
      color: "text-text-primary",
      iconBg: "bg-bg-tertiary",
      iconColor: "text-text-secondary",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: "Refusés",
      value: rejectedCount,
      color: "text-error",
      iconBg: "bg-[#FEE2E2]",
      iconColor: "text-error",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-8">

      {/* En-tête */}
      <div>
        <h1 className="page-title">
          Bonjour, {session.user.name.split(" ")[0]}
        </h1>
        <p className="page-subtitle font-[family-name:var(--font-roboto)]">
          Tableau de bord — Beli & Jolie Administration
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`stat-card flex items-start gap-4 ${stat.alert ? "ring-2 ring-warning/30" : ""}`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${stat.iconBg} ${stat.iconColor}`}>
              {stat.icon}
            </div>
            <div>
              <p className={`font-[family-name:var(--font-poppins)] text-3xl font-bold ${stat.color}`}>
                {stat.value}
              </p>
              <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary mt-0.5">
                {stat.label}
              </p>
              {stat.alert && (
                <span className="inline-flex items-center gap-1 text-xs text-warning font-medium mt-1 font-[family-name:var(--font-roboto)]">
                  Action requise
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Comptes en attente */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-text-primary">
            Demandes en attente
          </h2>
          {pendingCount > 5 && (
            <Link
              href="/admin/utilisateurs?status=PENDING"
              className="text-sm text-text-primary hover:text-text-secondary font-[family-name:var(--font-roboto)] font-medium transition-colors underline underline-offset-2"
            >
              Voir tout ({pendingCount})
            </Link>
          )}
        </div>

        {latestPending.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-[family-name:var(--font-roboto)] text-text-secondary text-sm">
              Aucune demande en attente. Tout est à jour !
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {/* En-tête tableau */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-border table-header">
              {["Nom / Société", "Email", "SIRET", "Actions"].map((h) => (
                <span key={h} className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                  {h}
                </span>
              ))}
            </div>

            {/* Lignes */}
            {latestPending.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 md:gap-4 px-5 py-4 table-row items-center"
              >
                <div>
                  <p className="font-[family-name:var(--font-roboto)] font-medium text-text-primary text-sm">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)]">
                    {user.company}
                  </p>
                </div>
                <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary truncate">
                  {user.email}
                </p>
                <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary font-mono">
                  {user.siret}
                </p>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/utilisateurs/${user.id}`}
                    className="btn-primary text-xs"
                  >
                    Examiner
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Liens rapides */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: "Gérer les clients",
            href: "/admin/utilisateurs",
            desc: "Voir et valider les comptes",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            ),
          },
          {
            label: "Gérer les produits",
            href: "/admin/produits",
            desc: "Ajouter ou modifier le catalogue",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            ),
          },
          {
            label: "Voir le site",
            href: "/",
            desc: "Retourner sur la boutique",
            icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            ),
          },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="card card-hover p-5 flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-bg-tertiary text-text-secondary">
              {link.icon}
            </div>
            <div>
              <p className="font-[family-name:var(--font-roboto)] font-semibold text-text-primary text-sm group-hover:text-text-secondary transition-colors">
                {link.label} →
              </p>
              <p className="text-xs text-text-muted mt-1 font-[family-name:var(--font-roboto)]">
                {link.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
