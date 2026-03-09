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
      prisma.user.count({ where: { status: "APPROVED" } }),
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
    { label: "Clients actifs", value: approvedCount, color: "text-[#0F3460]", bg: "bg-[#F1F5F9]" },
    { label: "En attente", value: pendingCount, color: "text-amber-600", bg: "bg-amber-50", alert: pendingCount > 0 },
    { label: "Total inscrits", value: totalClients, color: "text-[#0F172A]", bg: "bg-[#FFFFFF]" },
    { label: "Refusés", value: rejectedCount, color: "text-red-600", bg: "bg-red-50" },
  ];

  return (
    <div className="space-y-8">

      {/* En-tête */}
      <div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#0F172A]">
          Bonjour, {session.user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 font-[family-name:var(--font-roboto)] text-sm text-[#475569]">
          Tableau de bord — Beli & Jolie Administration
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`${stat.bg} border border-[#E2E8F0] p-5 ${stat.alert ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
          >
            <p className={`font-[family-name:var(--font-poppins)] text-3xl font-semibold ${stat.color}`}>
              {stat.value}
            </p>
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] mt-1">
              {stat.label}
            </p>
            {stat.alert && (
              <p className="text-xs text-amber-600 font-medium mt-1 font-[family-name:var(--font-roboto)]">
                Action requise
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Comptes en attente */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#0F172A]">
            Demandes en attente
          </h2>
          {pendingCount > 5 && (
            <Link
              href="/admin/utilisateurs?status=PENDING"
              className="text-sm text-[#0F3460] hover:text-[#0A2540] font-[family-name:var(--font-roboto)] font-medium transition-colors"
            >
              Voir tout ({pendingCount})
            </Link>
          )}
        </div>

        {latestPending.length === 0 ? (
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-8 text-center">
            <svg className="w-10 h-10 text-[#E2E8F0] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-[family-name:var(--font-roboto)] text-[#475569] text-sm">
              Aucune demande en attente. Tout est à jour !
            </p>
          </div>
        ) : (
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] overflow-hidden">
            {/* En-tête tableau */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-[#E2E8F0] bg-[#F1F5F9]">
              {["Nom / Société", "Email", "SIRET", "Actions"].map((h) => (
                <span key={h} className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider">
                  {h}
                </span>
              ))}
            </div>

            {/* Lignes */}
            {latestPending.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 md:gap-4 px-5 py-4 border-b border-[#F1F5F9] last:border-0 items-center"
              >
                <div>
                  <p className="font-[family-name:var(--font-roboto)] font-medium text-[#0F172A] text-sm">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-[#475569] font-[family-name:var(--font-roboto)]">
                    {user.company}
                  </p>
                </div>
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] truncate">
                  {user.email}
                </p>
                <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] font-mono">
                  {user.siret}
                </p>
                <div className="flex gap-2">
                  <Link
                    href={`/admin/utilisateurs/${user.id}`}
                    className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#0F3460] border border-[#0F3460] px-3 py-1.5 hover:bg-[#0F3460] hover:text-[#FFFFFF] transition-colors"
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
          { label: "Gérer les clients", href: "/admin/utilisateurs", desc: "Voir et valider les comptes" },
          { label: "Gérer les produits", href: "/admin/produits", desc: "Ajouter ou modifier le catalogue" },
          { label: "Voir le site", href: "/", desc: "Retourner sur la boutique" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-[#FFFFFF] border border-[#E2E8F0] p-5 hover:border-[#0F3460] transition-colors group"
          >
            <p className="font-[family-name:var(--font-roboto)] font-semibold text-[#0F172A] text-sm group-hover:text-[#0F3460] transition-colors">
              {link.label} →
            </p>
            <p className="text-xs text-[#475569] mt-1 font-[family-name:var(--font-roboto)]">
              {link.desc}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
