import { prisma } from "@/lib/prisma";
import { getStripeAccountInfo } from "@/lib/stripe";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import StripeStepForm from "@/components/admin/onboarding/StripeStepForm";
import StripeAccountStatusCard from "@/components/admin/onboarding/StripeAccountStatusCard";

export const dynamic = "force-dynamic";

export default async function StripeStepPage() {
  const [info, publishableRow] = await Promise.all([
    getStripeAccountInfo(),
    prisma.siteConfig.findFirst({ where: { key: "stripe_publishable_key" } }),
  ]);
  const publishable = publishableRow?.value?.trim() || "";

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
        <StripeAccountStatusCard info={info} />

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
            initialHasSecret={info.keysFromDb.hasSecret}
            initialHasWebhook={info.keysFromDb.hasWebhook}
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
