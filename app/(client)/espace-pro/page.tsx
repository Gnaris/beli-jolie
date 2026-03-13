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

const STATUS_CONFIG: Record<
  UserStatus,
  { label: string; description: string; bgClass: string; textClass: string; borderClass: string; dot: string }
> = {
  PENDING: {
    label: "En attente de validation",
    description: "Votre dossier est en cours d'examen. Vous recevrez une confirmation sous 48h ouvrées.",
    bgClass: "bg-amber-50",
    textClass: "text-amber-800",
    borderClass: "border-amber-200",
    dot: "bg-amber-400",
  },
  APPROVED: {
    label: "Compte actif",
    description: "Votre compte est validé. Accès complet au catalogue et aux tarifs professionnels.",
    bgClass: "bg-green-50",
    textClass: "text-green-800",
    borderClass: "border-green-200",
    dot: "bg-green-500",
  },
  REJECTED: {
    label: "Demande refusée",
    description: "Votre demande n'a pas été acceptée. Contactez-nous pour plus d'informations.",
    bgClass: "bg-red-50",
    textClass: "text-red-700",
    borderClass: "border-red-200",
    dot: "bg-red-500",
  },
};

export default async function EspaceProPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/connexion");

  const statusCfg = STATUS_CONFIG[user.status];
  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl">

      {/* En-tête */}
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A]">
          Bonjour, {user.firstName}
        </h1>
        <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] mt-0.5">
          {user.company} — Membre depuis le {formattedDate}
        </p>
      </div>

      {/* Bandeau statut */}
      <div className={`${statusCfg.bgClass} ${statusCfg.borderClass} border rounded-lg p-4 flex items-start gap-3 mb-6`}>
        <span className={`w-2 h-2 rounded-full ${statusCfg.dot} mt-1.5 shrink-0`} />
        <div>
          <p className={`text-sm font-[family-name:var(--font-roboto)] font-semibold ${statusCfg.textClass}`}>
            {statusCfg.label}
          </p>
          <p className={`text-sm font-[family-name:var(--font-roboto)] ${statusCfg.textClass} opacity-80 mt-0.5`}>
            {statusCfg.description}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Colonne principale ── */}
        <div className="lg:col-span-2 space-y-4">
          <InfoCard title="Informations personnelles">
            <InfoRow label="Prénom"    value={user.firstName} />
            <InfoRow label="Nom"       value={user.lastName} />
            <InfoRow label="Email"     value={user.email} />
            <InfoRow label="Téléphone" value={user.phone} />
          </InfoCard>

          <InfoCard title="Informations professionnelles">
            <InfoRow label="Société" value={user.company} />
            <InfoRow label="SIRET"   value={user.siret} mono />
            {user.vatNumber && (
              <InfoRow label="N° TVA" value={user.vatNumber} mono />
            )}
            <InfoRow
              label="Kbis"
              value={
                <a href="#kbis" className="text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] underline hover:text-[#555555] transition-colors">
                  Voir le document ↓
                </a>
              }
            />
          </InfoCard>

          <InfoCard title="Mon compte">
            <InfoRow label="Identifiant" value={user.id} mono small />
            <InfoRow
              label="Type"
              value={
                <span className="text-xs font-[family-name:var(--font-roboto)] font-medium bg-[#F5F5F5] text-[#555555] px-2.5 py-1 rounded border border-[#E5E5E5]">
                  Professionnel BtoB
                </span>
              }
            />
            <InfoRow label="Inscrit le" value={formattedDate} />
          </InfoCard>
        </div>

        {/* ── Colonne latérale ── */}
        <div className="space-y-4">
          {user.status === "APPROVED" ? (
            <div className="bg-white border border-[#E5E5E5] rounded-lg p-5 space-y-3">
              <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
                Accès rapide
              </h3>
              <Link href="/produits" className="btn-primary w-full justify-center text-xs">
                Voir le catalogue
              </Link>
              <Link href="/commandes" className="btn-outline w-full justify-center text-xs">
                Mes commandes
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
              <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] mb-2">
                Catalogue
              </h3>
              <p className="text-sm font-[family-name:var(--font-roboto)] text-[#999999]">
                {user.status === "PENDING"
                  ? "L'accès sera disponible une fois votre compte validé."
                  : "Votre accès a été suspendu. Contactez-nous."}
              </p>
            </div>
          )}

          <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
            <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] mb-2">
              Besoin d&apos;aide ?
            </h3>
            <p className="text-sm font-[family-name:var(--font-roboto)] text-[#999999] mb-3">
              Notre équipe est disponible du lundi au vendredi, 9h–18h.
            </p>
            <Link
              href="/contact"
              className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] hover:text-[#555555] flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Contacter le support
            </Link>
          </div>
        </div>
      </div>

      {/* Section Kbis */}
      <div id="kbis" className="mt-5 bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
            Document Kbis
          </h2>
          <span className="text-xs font-[family-name:var(--font-roboto)] text-[#999999]">
            Lecture seule — contactez-nous pour modifier
          </span>
        </div>
        <div className="p-5">
          <div className="bg-[#F5F5F5] border border-dashed border-[#E5E5E5] rounded-lg p-8 text-center">
            <svg className="w-8 h-8 text-[#CCCCCC] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-[family-name:var(--font-roboto)] font-medium text-[#555555] mb-1">
              Kbis déposé lors de votre inscription
            </p>
            <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999]">
              Conservé de manière sécurisée, accessible uniquement à notre équipe.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-[#E5E5E5] bg-[#FAFAFA]">
        <h2 className="font-[family-name:var(--font-roboto)] text-xs font-semibold text-[#999999] uppercase tracking-wider">
          {title}
        </h2>
      </div>
      <div className="divide-y divide-[#F5F5F5]">
        {children}
      </div>
    </div>
  );
}

function InfoRow({
  label, value, mono = false, small = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
      <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#999999] uppercase tracking-wider w-28 shrink-0">
        {label}
      </span>
      <span className={`text-[#1A1A1A] ${mono ? "font-mono text-sm" : "font-[family-name:var(--font-roboto)]"} ${small ? "text-xs text-[#555555] break-all" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}
