import { prisma } from "@/lib/prisma";
import { getStripeConfigStatus } from "@/lib/stripe";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import StripeStepForm from "@/components/admin/onboarding/StripeStepForm";

export const dynamic = "force-dynamic";

export default async function StripeStepPage() {
  const [status, publishableRow] = await Promise.all([
    getStripeConfigStatus(),
    prisma.siteConfig.findFirst({ where: { key: "stripe_publishable_key" } }),
  ]);
  const publishable =
    publishableRow?.value?.trim() ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    "";

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="💳"
        eyebrow="Étape 4 — Encaissement"
        title="Recevez les paiements par carte bancaire"
        description={
          <>
            Stripe encaisse pour vous et vous vire l&apos;argent chaque
            semaine. Renseignez vos 3 clés Stripe ci-dessous — elles sont
            chiffrées en base de données.
          </>
        }
        accent="amber"
      />

      <div className="space-y-6">
        {/* Status card */}
        <section
          className={`rounded-3xl border p-6 md:p-8 shadow-sm ${
            status.ready
              ? "bg-emerald-50/60 border-emerald-200"
              : "bg-amber-50/60 border-amber-200"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl ${
                status.ready ? "bg-emerald-100" : "bg-amber-100"
              }`}
            >
              {status.ready ? "✅" : "⏳"}
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                {status.ready
                  ? "Stripe est branché"
                  : "Stripe n'est pas encore branché"}
              </p>
              <p className="text-sm text-text-secondary">
                {status.ready
                  ? status.testMode
                    ? "Mode TEST actif — utilisez la carte 4242 4242 4242 4242 pour essayer."
                    : "Mode LIVE — les paiements arrivent sur votre compte Stripe."
                  : "Renseignez vos 3 clés Stripe pour activer le paiement en ligne."}
              </p>
            </div>
          </div>
          {status.source === "env" && (
            <p className="text-xs text-text-secondary/70 mt-3">
              💡 Configuration actuelle : lue dans le fichier <code>.env</code>{" "}
              du serveur. Remplissez le formulaire ci-dessous pour la migrer en
              base de données (chiffrée).
            </p>
          )}
        </section>

        {/* Guide compact */}
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-600 font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-3 bg-amber-500 rounded" /> Comment récupérer vos clés
          </p>
          <ol className="space-y-3 text-sm text-text-secondary">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">1</span>
              <span>
                Créez votre compte sur{" "}
                <a
                  href="https://dashboard.stripe.com/register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 font-semibold underline hover:no-underline"
                >
                  dashboard.stripe.com/register
                </a>
                . Renseignez votre SIRET et votre RIB (vérification 24-48h).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">2</span>
              <span>
                Dans <strong>Développeurs → Clés API</strong>, copiez la clé
                secrète (sk_…) et la clé publique (pk_…).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">3</span>
              <span>
                Dans <strong>Développeurs → Webhooks</strong>, créez un
                endpoint sur <code>votre-site.fr/api/payments/webhook</code>.
                Copiez la signature (whsec_…).
              </span>
            </li>
          </ol>
        </section>

        {/* Formulaire */}
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-600 font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-3 bg-amber-500 rounded" /> Vos clés Stripe
          </p>
          <StripeStepForm
            initialHasSecret={status.hasSecret}
            initialHasWebhook={status.hasWebhook}
            initialPublishable={publishable}
          />
        </section>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="stripe"
            nextPath="/admin/bienvenue/email"
            label="Passer et brancher plus tard"
          />
        </div>
      </div>
    </div>
  );
}
