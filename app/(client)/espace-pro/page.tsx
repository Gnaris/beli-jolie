import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Mon Espace Pro",
  description: "Gérez votre compte professionnel Beli & Jolie.",
  robots: { index: false, follow: false },
};

/** Configuration visuelle par statut de compte */
const STATUS_CONFIG: Record<
  UserStatus,
  { label: string; description: string; bgClass: string; textClass: string; borderClass: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: "En attente de validation",
    description:
      "Votre dossier est en cours d'examen par notre équipe. Vous recevrez une confirmation sous 48h ouvrées.",
    bgClass: "bg-amber-50",
    textClass: "text-amber-800",
    borderClass: "border-amber-200",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  APPROVED: {
    label: "Compte actif",
    description: "Votre compte est validé. Vous avez accès à l'ensemble de notre catalogue et aux tarifs professionnels.",
    bgClass: "bg-emerald-50",
    textClass: "text-emerald-800",
    borderClass: "border-emerald-200",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  REJECTED: {
    label: "Demande refusée",
    description:
      "Votre demande d'accès n'a pas été acceptée. Contactez-nous pour plus d'informations.",
    bgClass: "bg-red-50",
    textClass: "text-red-800",
    borderClass: "border-red-200",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

/**
 * Page Espace Pro — /espace-pro
 * Affiche toutes les informations du compte client connecté
 */
export default async function EspaceProPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  // Récupération des données complètes depuis la base
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) redirect("/connexion");

  const statusCfg = STATUS_CONFIG[user.status];

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="container-site py-10 md:py-14 space-y-8">

      {/* En-tête de bienvenue */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#0F3460] mb-2">
            Tableau de bord
          </p>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#0F172A]">
            Bonjour, {user.firstName} 👋
          </h1>
          <p className="mt-1 text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
            {user.company} — Membre depuis le {formattedDate}
          </p>
        </div>

        {/* Bouton déconnexion */}
        <Link
          href="/api/auth/signout"
          className="btn-outline text-sm self-start sm:self-center"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          Se déconnecter
        </Link>
      </div>

      {/* Bandeau statut du compte */}
      <div className={`${statusCfg.bgClass} ${statusCfg.borderClass} border p-4 flex items-start gap-3`}>
        <span className={`${statusCfg.textClass} mt-0.5 shrink-0`}>
          {statusCfg.icon}
        </span>
        <div>
          <p className={`text-sm font-[family-name:var(--font-roboto)] font-semibold ${statusCfg.textClass}`}>
            {statusCfg.label}
          </p>
          <p className={`text-sm font-[family-name:var(--font-roboto)] ${statusCfg.textClass} opacity-80 mt-0.5`}>
            {statusCfg.description}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Colonne principale : Informations ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Informations personnelles */}
          <InfoCard title="Informations personnelles">
            <InfoRow label="Prénom"    value={user.firstName} />
            <InfoRow label="Nom"       value={user.lastName} />
            <InfoRow label="Email"     value={user.email} />
            <InfoRow label="Téléphone" value={user.phone} />
          </InfoCard>

          {/* Informations professionnelles */}
          <InfoCard title="Informations professionnelles">
            <InfoRow label="Société" value={user.company} />
            <InfoRow label="SIRET"   value={user.siret} mono />
            <InfoRow
              label="Kbis"
              value={
                <a
                  href="#kbis"
                  className="text-[#0F3460] hover:text-[#0A2540] underline underline-offset-2 text-sm font-[family-name:var(--font-roboto)] transition-colors"
                >
                  Voir le document joint ↓
                </a>
              }
            />
          </InfoCard>

          {/* Informations du compte */}
          <InfoCard title="Mon compte">
            <InfoRow label="Identifiant" value={user.id} mono small />
            <InfoRow
              label="Rôle"
              value={
                <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold bg-[#F1F5F9] text-[#0F3460] px-2.5 py-1 rounded-full">
                  Professionnel BtoB
                </span>
              }
            />
            <InfoRow label="Inscrit le" value={formattedDate} />
          </InfoCard>
        </div>

        {/* ── Colonne latérale : Accès rapides ── */}
        <div className="space-y-4">

          {/* Accès boutique si compte approuvé */}
          {user.status === "APPROVED" ? (
            <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-5 space-y-3">
              <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A]">
                Accès rapide
              </h3>
              <Link
                href="/boutique"
                className="btn-primary w-full justify-center text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                Accéder à la boutique
              </Link>
              <Link
                href="/commandes"
                className="btn-outline w-full justify-center text-sm"
              >
                Mes commandes
              </Link>
            </div>
          ) : (
            <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-5">
              <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A] mb-2">
                Boutique
              </h3>
              <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
                {user.status === "PENDING"
                  ? "L'accès à la boutique sera disponible une fois votre compte validé."
                  : "Votre accès à la boutique a été suspendu. Contactez-nous."}
              </p>
            </div>
          )}

          {/* Bloc contact */}
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-5">
            <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A] mb-2">
              Besoin d'aide ?
            </h3>
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569] mb-3">
              Notre équipe est disponible du lundi au vendredi, 9h–18h.
            </p>
            <Link
              href="/contact"
              className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#0F3460] hover:text-[#0A2540] flex items-center gap-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Contacter le support
            </Link>
          </div>
        </div>
      </div>

      {/* ── Section Kbis ── */}
      <div id="kbis" className="bg-[#FFFFFF] border border-[#E2E8F0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F1F5F9] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#0F172A]">
            Document Kbis fourni à l'inscription
          </h2>
          <span className="text-xs font-[family-name:var(--font-roboto)] text-[#475569]">
            Lecture seule — contactez-nous pour modifier
          </span>
        </div>
        <div className="p-5">
          <div className="bg-[#F1F5F9] border border-dashed border-[#E2E8F0] p-8 text-center">
            <svg className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#475569] mb-1">
              Kbis déposé lors de votre inscription
            </p>
            <p className="text-xs font-[family-name:var(--font-roboto)] text-[#94A3B8]">
              Le document est conservé de manière sécurisée et accessible uniquement à notre équipe.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────
// Composants réutilisables de la page
// ─────────────────────────────────────────────

/** Carte d'information avec titre */
function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#FFFFFF] border border-[#E2E8F0] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F1F5F9]">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] uppercase tracking-wide">
          {title}
        </h2>
      </div>
      <div className="divide-y divide-[#F1F5F9]">
        {children}
      </div>
    </div>
  );
}

/** Ligne label / valeur */
function InfoRow({
  label,
  value,
  mono = false,
  small = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3.5">
      <span className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider w-32 shrink-0">
        {label}
      </span>
      <span
        className={`text-[#0F172A] ${
          mono ? "font-mono text-sm" : "font-[family-name:var(--font-roboto)]"
        } ${small ? "text-xs text-[#475569] break-all" : "text-sm"}`}
      >
        {value}
      </span>
    </div>
  );
}
