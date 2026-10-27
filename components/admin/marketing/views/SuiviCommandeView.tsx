import Link from "next/link";
import { getOrderFollowupReviewConfig } from "@/app/actions/admin/order-followup-review";
import SuiviCommandeEditor from "@/components/admin/marketing/SuiviCommandeEditor";

export default async function SuiviCommandeView() {
  const config = await getOrderFollowupReviewConfig();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-teal-200/40 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-teal-800">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                Mail automatique · Suivi après expédition
              </span>
              <h1 className="page-title mt-4">Relance après expédition</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Envoyez automatiquement un mail à vos clients <strong>{config.delayDays} jours
                après l&apos;expédition</strong> de leur commande. Idéal pour prendre
                des nouvelles, demander un avis sur votre site ou sur Google,
                inviter à repasser commande. Envoyé une seule fois par commande.
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

      <SuiviCommandeEditor initialEnabled={config.enabled} delayDays={config.delayDays} />
    </div>
  );
}
