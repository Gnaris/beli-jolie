import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { listNewsletterTemplates } from "@/app/actions/admin/newsletter-templates";
import NewslettersListClient from "@/components/admin/users/NewslettersListClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modèles de mail — Admin" };

export default async function MailsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const templates = await listNewsletterTemplates();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-violet-200/30 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-violet-800">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                Mails clients
              </span>
              <h1 className="page-title mt-4">Mes modèles de mail</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Composez plusieurs modèles à l&apos;avance (nouvelle collection, saison, événement…). Choisissez celui à envoyer au moment de l&apos;envoi groupé. Les mails automatiques (panier abandonné, inactivité, retour en stock) partent tout seuls aux moments configurés.
              </p>
            </div>
            <Link
              href="/admin/clients"
              className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary"
            >
              ← Retour à la liste des clients
            </Link>
          </div>
        </div>
      </section>

      <NewslettersListClient templates={templates} />
    </div>
  );
}
