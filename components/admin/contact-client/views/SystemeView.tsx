import Link from "next/link";
import { listTransactionalOverrides } from "@/app/actions/admin/transactional-emails";
import TransactionalEmailsGrid from "@/components/admin/transactional-emails/TransactionalEmailsGrid";

export default async function SystemeView() {
  const overrides = await listTransactionalOverrides();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-slate-200/40 pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                Mails système
              </span>
              <h1 className="page-title mt-4">Personnaliser les mails du site</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Chaque mail transactionnel part automatiquement d&apos;un modèle par défaut. Cliquez sur une carte pour écrire votre propre version (sujet + contenu), dans la langue de votre choix. À tout moment, un bouton{" "}
                <strong>Revenir au modèle par défaut</strong>{" "}
                remet celui d&apos;origine.
              </p>
            </div>
            <Link
              href="/admin/contact-client/mails"
              className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary"
            >
              ← Retour aux modèles de mail
            </Link>
          </div>
        </div>
      </section>

      <TransactionalEmailsGrid overrides={overrides} />
    </div>
  );
}
