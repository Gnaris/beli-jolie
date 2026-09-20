import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getInactiveClientConfig } from "@/app/actions/admin/inactive-client";
import InactiveClientStagesEditor from "@/components/admin/users/InactiveClientStagesEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relances inactivité — Admin" };

export default async function InactiveClientPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const config = await getInactiveClientConfig();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-violet-200/40 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-violet-800">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                Mail automatique · Relance inactivité
              </span>
              <h1 className="page-title mt-4">Relances inactivité</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Configurez des relances par mail automatiques pour les clients
                qui n&apos;ont plus donné signe de vie depuis un moment. Chaque
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

      <InactiveClientStagesEditor initialConfig={config} />
    </div>
  );
}
