import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";

export const dynamic = "force-dynamic";

function detectStripeStatus() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const testMode = secret?.startsWith("sk_test_");
  return {
    hasSecret: !!secret,
    hasPublishable: !!publishable,
    hasWebhook: !!webhook,
    testMode: !!testMode,
    ready: !!secret && !!publishable && !!webhook,
  };
}

export default async function StripeStepPage() {
  const status = detectStripeStatus();

  const rowStyle =
    "flex items-center justify-between gap-4 py-3 border-b border-border last:border-0";

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="💳"
        eyebrow="Étape 4 — Encaissement"
        title="Recevez les paiements de vos clients"
        description={
          <>
            Vos clients paient par carte bancaire via Stripe. C&apos;est Stripe
            qui virera l&apos;argent sur votre compte en banque toutes les
            semaines.
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
          <div className="flex items-center gap-3 mb-4">
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
                  : "Envoyez-nous vos clés Stripe et on les branche pour vous."}
              </p>
            </div>
          </div>

          <div className="mt-2 bg-white/70 rounded-2xl px-4">
            <div className={rowStyle}>
              <span className="text-sm text-text-secondary">
                Clé secrète (STRIPE_SECRET_KEY)
              </span>
              <span
                className={`text-sm font-semibold ${
                  status.hasSecret ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasSecret
                  ? status.testMode
                    ? "✓ Configurée (test)"
                    : "✓ Configurée (live)"
                  : "— Manquante"}
              </span>
            </div>
            <div className={rowStyle}>
              <span className="text-sm text-text-secondary">
                Clé publique (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
              </span>
              <span
                className={`text-sm font-semibold ${
                  status.hasPublishable ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasPublishable ? "✓ Configurée" : "— Manquante"}
              </span>
            </div>
            <div className={rowStyle}>
              <span className="text-sm text-text-secondary">
                Signature webhook (STRIPE_WEBHOOK_SECRET)
              </span>
              <span
                className={`text-sm font-semibold ${
                  status.hasWebhook ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasWebhook ? "✓ Configurée" : "— Manquante"}
              </span>
            </div>
          </div>
        </section>

        {/* Guide */}
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-600 font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-3 bg-amber-500 rounded" /> Comment faire ?
          </p>
          <h2 className="font-heading text-xl font-bold text-text-primary mb-4">
            Créer votre compte Stripe (10 minutes)
          </h2>
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold flex items-center justify-center">
                1
              </span>
              <div className="text-sm text-text-secondary">
                Allez sur{" "}
                <a
                  href="https://dashboard.stripe.com/register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 font-semibold underline hover:no-underline"
                >
                  dashboard.stripe.com/register
                </a>{" "}
                et créez votre compte avec l&apos;email de votre boutique.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold flex items-center justify-center">
                2
              </span>
              <div className="text-sm text-text-secondary">
                Renseignez votre entreprise (SIRET, RIB) — Stripe vérifie
                votre identité, ça prend 24 à 48 h.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold flex items-center justify-center">
                3
              </span>
              <div className="text-sm text-text-secondary">
                Une fois validée, envoyez-nous par mail vos deux clés Stripe
                (elles se trouvent dans <strong>Développeurs &rsaquo; Clés
                API</strong>). On les installe pour vous en quelques minutes.
              </div>
            </li>
          </ol>

          <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
            <p className="font-semibold mb-1">💡 Pas pressée ?</p>
            <p>
              Vous pouvez passer cette étape et brancher Stripe plus tard.
              Votre boutique fonctionnera en vitrine, mais les clients ne
              pourront pas encore payer en ligne.
            </p>
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="stripe"
            nextPath="/admin/bienvenue/email"
            label={status.ready ? "Stripe est prêt, continuer" : "J'ai compris, continuer"}
          />
        </div>
      </div>
    </div>
  );
}
