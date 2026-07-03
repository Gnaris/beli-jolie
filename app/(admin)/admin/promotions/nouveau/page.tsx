import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import PromotionForm from "@/components/admin/promotions/PromotionForm";

export const metadata = { title: "Nouvelle promotion — Admin" };

export default async function NewPromotionPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  return (
    <div className="space-y-6">
      {/* Hero compact avec breadcrumb */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-slate-300/25 pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <div className="text-[12px] text-text-muted mb-2 flex items-center gap-1.5">
            <Link href="/admin/promotions" className="hover:text-text-primary transition-colors">Promotions</Link>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-text-secondary">Nouvelle</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Création d&apos;une promotion
              </span>
              <h1 className="page-title mt-3">Nouvelle promotion</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Créez un code promo ou une remise automatique — l&apos;aperçu se met à jour en direct dans la carte de droite.
              </p>
            </div>
          </div>
        </div>
      </section>

      <PromotionForm />
    </div>
  );
}
