import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import {
  getAbandonedCartConfig,
  listPendingAbandonedCartJobs,
} from "@/app/actions/admin/abandoned-cart";
import AbandonedCartStagesEditor from "@/components/admin/users/AbandonedCartStagesEditor";
import PendingAbandonedCartQueue from "@/components/admin/users/PendingAbandonedCartQueue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relances panier abandonné — Admin" };

export default async function AbandonedCartPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const [config, pendingJobs] = await Promise.all([
    getAbandonedCartConfig(),
    listPendingAbandonedCartJobs(),
  ]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-amber-200/40 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-amber-800">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Mail automatique · Panier abandonné
              </span>
              <h1 className="page-title mt-4">Relances panier abandonné</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Configurez des relances par mail automatiques quand un client
                laisse des articles dans son panier sans commander. Chaque
                stade a son délai et son propre modèle de mail.
              </p>
            </div>
            <Link
              href="/admin/marketing/mails"
              className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary"
            >
              ← Retour aux modèles de mail
            </Link>
          </div>
        </div>
      </section>

      <AbandonedCartStagesEditor initialConfig={config} />

      <PendingAbandonedCartQueue initialJobs={pendingJobs} />
    </div>
  );
}
