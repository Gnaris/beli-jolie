import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { listWhatsAppTemplates } from "@/app/actions/admin/whatsapp-templates";
import { getCachedShopName, getCachedCompanyInfo } from "@/lib/cached-data";
import { prisma } from "@/lib/prisma";
import WhatsAppTemplatesPane from "@/components/admin/marketing/whatsapp/WhatsAppTemplatesPane";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modèles WhatsApp — Admin" };

export default async function WhatsAppTemplatesPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const [templates, shopName, company, thirtyDaysCount, clients] = await Promise.all([
    listWhatsAppTemplates(),
    getCachedShopName(),
    getCachedCompanyInfo(),
    prisma.whatsAppSend.count({
      where: { sentAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
    }),
    // Liste des clients APPROVED pour permettre l'aperçu sur un vrai contact
    // dans le drawer d'édition. On ne charge que les colonnes utiles au sélecteur.
    prisma.user.findMany({
      where: { role: "CLIENT", status: "APPROVED" },
      select: { id: true, firstName: true, lastName: true, company: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);

  const previewOverrides = {
    shopName,
    shopAddress: company?.address
      ? [company.address, company.postalCode, company.city].filter(Boolean).join(", ")
      : "",
    shopEmail: company?.email ?? "",
    shopPhone: company?.phone ?? "",
    shopWebsite: company?.website ?? "",
    adminFirstName: session.user.name?.split(" ")[0] ?? "Admin",
    adminLastName: session.user.name?.split(" ").slice(1).join(" ") ?? "",
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-emerald-200/30 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Modèles WhatsApp
              </span>
              <h1 className="page-title mt-4">Mes modèles WhatsApp</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Rédigez à l&apos;avance des messages courts que vous enverrez d&apos;un clic depuis la page clients.
                Le mini-menu sur l&apos;icône WhatsApp verte propose la liste — vous choisissez, WhatsApp s&apos;ouvre
                avec le texte pré-rempli et vos variables (prénom, société…) déjà remplacées.
              </p>
            </div>
            <Link
              href="/admin/clients"
              className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary"
            >
              ← Retour à la liste des clients
            </Link>
          </div>

          <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-md">
            <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary p-4 shadow-sm">
              <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-emerald-700">
                Modèles
              </p>
              <p className="font-heading text-3xl font-bold tabular-nums text-emerald-700 mt-1">
                {templates.length}
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-bg-primary to-bg-primary p-4 shadow-sm">
              <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-sky-700">
                Envois 30 j
              </p>
              <p className="font-heading text-3xl font-bold tabular-nums text-sky-700 mt-1">
                {thirtyDaysCount}
              </p>
            </div>
          </div>
        </div>
      </section>

      <WhatsAppTemplatesPane
        templates={templates}
        previewOverrides={previewOverrides}
        clients={clients}
      />
    </div>
  );
}
