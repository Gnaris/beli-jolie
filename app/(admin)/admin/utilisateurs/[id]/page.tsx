import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import type { UserStatus } from "@prisma/client";

/** Correspondance statut → styles */
const STATUS_CONFIG: Record<UserStatus, { label: string; className: string; icon: string }> = {
  PENDING:  { label: "En attente de validation", className: "bg-amber-100 text-amber-700 border-amber-200",   icon: "⏳" },
  APPROVED: { label: "Compte approuvé",          className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: "✅" },
  REJECTED: { label: "Compte rejeté",            className: "bg-red-100 text-red-700 border-red-200",         icon: "❌" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  return {
    title: user
      ? `Dossier ${user.firstName} ${user.lastName} — Admin`
      : "Dossier client — Admin",
  };
}

/**
 * Page détail client — /admin/utilisateurs/[id]
 *
 * Affiche toutes les informations du client + le Kbis
 * Boutons Approuver / Rejeter via Server Actions
 */
export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user || user.role === "ADMIN") notFound();

  const statusCfg = STATUS_CONFIG[user.status];

  // Extraction du nom de fichier depuis le chemin stocké en base
  const kbisFilename = user.kbisPath.split("/").pop() ?? "";
  const kbisApiUrl  = `/api/admin/kbis/${kbisFilename}`;
  const kbisExt     = kbisFilename.split(".").pop()?.toLowerCase() ?? "";
  const isPdf       = kbisExt === "pdf";

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45]" aria-label="Fil d'Ariane">
        <Link href="/admin" className="hover:text-[#8B7355] transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href="/admin/utilisateurs" className="hover:text-[#8B7355] transition-colors">Clients</Link>
        <span>/</span>
        <span className="text-[#2C2418] font-medium">{user.firstName} {user.lastName}</span>
      </nav>

      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#2C2418]">
            {user.firstName} {user.lastName}
          </h1>
          <p className="mt-1 text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45]">
            {user.company} — Inscrit le {formattedDate}
          </p>
        </div>

        {/* Badge statut */}
        <span className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-[family-name:var(--font-roboto)] font-semibold border rounded-full w-fit ${statusCfg.className}`}>
          <span>{statusCfg.icon}</span>
          {statusCfg.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Informations du client ── */}
        <div className="bg-[#FDFAF6] border border-[#D4CCBE] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#D4CCBE] bg-[#EDE8DF]">
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#2C2418]">
              Informations personnelles & professionnelles
            </h2>
          </div>
          <div className="p-5 space-y-4">
            {[
              { label: "Prénom",    value: user.firstName },
              { label: "Nom",       value: user.lastName },
              { label: "Société",   value: user.company },
              { label: "Email",     value: user.email },
              { label: "Téléphone", value: user.phone },
              { label: "SIRET",     value: user.siret, mono: true },
              { label: "Rôle",      value: user.role },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider w-28 shrink-0">
                  {label}
                </span>
                <span className={`text-sm text-[#2C2418] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Kbis ── */}
        <div className="bg-[#FDFAF6] border border-[#D4CCBE] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#D4CCBE] bg-[#EDE8DF] flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#2C2418]">
              Extrait Kbis
            </h2>
            {/* Bouton téléchargement */}
            <a
              href={kbisApiUrl}
              download={kbisFilename}
              className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#8B7355] hover:text-[#6B5640] flex items-center gap-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Télécharger
            </a>
          </div>

          {/* Aperçu du document */}
          <div className="flex-1 p-4 min-h-64">
            {isPdf ? (
              <iframe
                src={kbisApiUrl}
                title="Extrait Kbis"
                className="w-full h-80 border-0"
                aria-label="Aperçu du Kbis au format PDF"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={kbisApiUrl}
                alt={`Kbis de ${user.company}`}
                className="w-full h-auto max-h-80 object-contain"
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Actions Approuver / Rejeter ── */}
      {user.status === "PENDING" && (
        <div className="bg-amber-50 border border-amber-200 p-5">
          <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-amber-800 mb-4">
            Ce dossier est en attente de validation. Après vérification des informations et du Kbis, vous pouvez approuver ou rejeter cette demande.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">

            {/* Approuver */}
            <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
              <button
                type="submit"
                className="flex items-center gap-2 bg-emerald-600 text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-6 py-2.5 hover:bg-emerald-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approuver le compte
              </button>
            </form>

            {/* Rejeter */}
            <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
              <button
                type="submit"
                className="flex items-center gap-2 bg-red-600 text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-6 py-2.5 hover:bg-red-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Rejeter la demande
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Si déjà traité — possibilité de changer d'avis */}
      {user.status !== "PENDING" && (
        <div className="bg-[#FDFAF6] border border-[#D4CCBE] p-5">
          <p className="text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45] mb-4">
            Ce dossier a déjà été traité. Vous pouvez modifier la décision si nécessaire.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {user.status === "REJECTED" && (
              <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
                <button type="submit" className="flex items-center gap-2 bg-emerald-600 text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-5 py-2 hover:bg-emerald-700 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Approuver quand même
                </button>
              </form>
            )}
            {user.status === "APPROVED" && (
              <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
                <button type="submit" className="flex items-center gap-2 bg-red-600 text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-5 py-2 hover:bg-red-700 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Révoquer l'accès
                </button>
              </form>
            )}
            <Link
              href="/admin/utilisateurs"
              className="flex items-center gap-1 text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45] hover:text-[#8B7355] transition-colors px-5 py-2"
            >
              ← Retour à la liste
            </Link>
          </div>
        </div>
      )}

    </div>
  );
}
