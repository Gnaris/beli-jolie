import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listReviewsForModeration } from "@/app/actions/admin/customer-reviews";
import { getCachedShopName } from "@/lib/cached-data";
import AvisModerationClient from "@/components/admin/reviews/AvisModerationClient";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Avis clients — ${shopName} Admin` };
}

export default async function AvisAdminPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { pending, moderated } = await listReviewsForModeration();

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm bg-bg-primary">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-20 -right-16 w-72 h-72 rounded-full blur-3xl bg-amber-200/30 pointer-events-none" />
        <div className="relative p-6 lg:p-8">
          <div className="text-[12px] text-text-muted mb-2 flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-text-secondary">Avis clients</span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]" />
                Modération · {pending.length} en attente
              </span>
              <h1 className="page-title mt-3">Avis clients</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Vos clients laissent leurs témoignages depuis leur espace pro.
                Vous les vérifiez avant qu&apos;ils s&apos;affichent sur la page d&apos;accueil.
              </p>
            </div>
          </div>
        </div>
      </section>

      <AvisModerationClient pending={pending} moderated={moderated} />
    </div>
  );
}
