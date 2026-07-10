import { getCompanyInfo } from "@/app/actions/admin/company-info";
import { getSmtpConfigStatus } from "@/lib/email";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import MailboxProvisionForm from "@/components/admin/onboarding/MailboxProvisionForm";

function extractShopDomain(): string | null {
  const url = process.env.NEXTAUTH_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function EmailStepPage() {
  const [status, company] = await Promise.all([
    getSmtpConfigStatus(),
    getCompanyInfo(),
  ]);
  const notifyEmail = company?.email?.trim() || "";
  const shopDomain = extractShopDomain();

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="📬"
        eyebrow="Étape 5 — Envoi d'emails"
        title="Votre site doit pouvoir écrire à vos clients"
        description={
          <>
            Confirmations de commande, mots de passe oubliés, notifications
            d&apos;expédition&nbsp;: on crée automatiquement votre boîte pro et
            on transfère tout vers votre adresse habituelle.
          </>
        }
        accent="sky"
      />

      <div className="space-y-6">
        {/* Statut */}
        <section
          className={`rounded-3xl border p-6 md:p-8 shadow-sm ${
            status.ready
              ? "bg-emerald-50/60 border-emerald-200"
              : "bg-amber-50/60 border-amber-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl ${
                status.ready ? "bg-emerald-100" : "bg-amber-100"
              }`}
            >
              {status.ready ? "📨" : "⏳"}
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                {status.ready
                  ? "La messagerie est branchée"
                  : "La messagerie n'est pas encore branchée"}
              </p>
              <p className="text-sm text-text-secondary">
                {status.ready
                  ? `Vos emails partent depuis ${status.fromEmail ?? status.user ?? "?"}.`
                  : "Renseignez votre email principal ci-dessous pour tout brancher automatiquement."}
              </p>
            </div>
          </div>
        </section>

        {/* Provisionnement automatique — sauf si déjà branché */}
        {!status.ready && shopDomain && (
          <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-600 font-semibold mb-3 flex items-center gap-2">
              <span className="w-1 h-3 bg-sky-500 rounded" /> On s&apos;occupe de tout
            </p>
            <h2 className="font-heading text-xl font-bold text-text-primary mb-1">
              Votre boîte <span className="font-mono">contact@{shopDomain}</span>
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              On crée automatiquement la boîte sur notre serveur, on la branche
              à votre site, et tous les mails clients arrivent sur votre
              adresse habituelle.
            </p>
            <MailboxProvisionForm
              defaultEmail={notifyEmail}
              shopDomain={shopDomain}
            />
          </section>
        )}

        {/* Cas d'erreur : domaine indéterminé */}
        {!status.ready && !shopDomain && (
          <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800">
              <p className="font-semibold mb-1">⚠️ Configuration serveur incomplète</p>
              <p>
                Le domaine de votre boutique n&apos;a pas pu être déterminé
                (NEXTAUTH_URL manquant côté serveur). Contactez le support pour
                brancher la messagerie.
              </p>
            </div>
          </section>
        )}

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="email"
            nextPath="/admin/bienvenue/livraison"
            label={status.ready ? "Messagerie prête, continuer" : "Passer et brancher plus tard"}
          />
        </div>
      </div>
    </div>
  );
}
