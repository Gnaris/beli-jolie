import { getCompanyInfo } from "@/app/actions/admin/company-info";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import EmailTestButton from "@/components/admin/onboarding/EmailTestButton";

export const dynamic = "force-dynamic";

function detectSmtpStatus() {
  const host = process.env.SMTP_HOST?.trim();
  const port = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";
  return {
    host: host || null,
    port: port || null,
    user: user || null,
    fromEmail,
    hasHost: !!host,
    hasPort: !!port,
    hasUser: !!user,
    hasPassword: !!password,
    ready: !!host && !!port && !!user && !!password,
  };
}

export default async function EmailStepPage() {
  const status = detectSmtpStatus();
  const company = await getCompanyInfo();
  const notifyEmail = company?.email?.trim() || "";
  const suggestedTest = notifyEmail || status.fromEmail || "";

  const row =
    "flex items-center justify-between gap-4 py-3 border-b border-border last:border-0";

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="📬"
        eyebrow="Étape 5 — Envoi d'emails"
        title="Votre site doit pouvoir écrire à vos clients"
        description={
          <>
            Confirmations de commande, mots de passe oubliés, notifications
            d&apos;expédition&nbsp;: tous ces emails partent depuis votre boîte
            professionnelle.
          </>
        }
        accent="sky"
      />

      <div className="space-y-6">
        <section
          className={`rounded-3xl border p-6 md:p-8 shadow-sm ${
            status.ready
              ? "bg-sky-50/60 border-sky-200"
              : "bg-amber-50/60 border-amber-200"
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl ${
                status.ready ? "bg-sky-100" : "bg-amber-100"
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
                  ? "Testez ci-dessous en vous envoyant un email de test."
                  : "Envoyez-nous vos identifiants SMTP et on les branche pour vous."}
              </p>
            </div>
          </div>

          <div className="mt-2 bg-white/70 rounded-2xl px-4">
            <div className={row}>
              <span className="text-sm text-text-secondary">Serveur (SMTP_HOST)</span>
              <span
                className={`text-sm font-semibold ${
                  status.hasHost ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasHost ? status.host : "— Manquant"}
              </span>
            </div>
            <div className={row}>
              <span className="text-sm text-text-secondary">Port</span>
              <span
                className={`text-sm font-semibold ${
                  status.hasPort ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasPort ? status.port : "— Manquant"}
              </span>
            </div>
            <div className={row}>
              <span className="text-sm text-text-secondary">Identifiant</span>
              <span
                className={`text-sm font-semibold ${
                  status.hasUser ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasUser ? status.user : "— Manquant"}
              </span>
            </div>
            <div className={row}>
              <span className="text-sm text-text-secondary">Mot de passe</span>
              <span
                className={`text-sm font-semibold ${
                  status.hasPassword ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {status.hasPassword ? "✓ Configuré" : "— Manquant"}
              </span>
            </div>
          </div>
        </section>

        {status.ready && (
          <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-600 font-semibold mb-3 flex items-center gap-2">
              <span className="w-1 h-3 bg-sky-500 rounded" /> Test d&apos;envoi
            </p>
            <h2 className="font-heading text-xl font-bold text-text-primary mb-1">
              Envoyez-vous un email de test
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              Pour vérifier que la boîte fonctionne. Regardez aussi dans vos
              indésirables (spam) si vous ne le voyez pas.
            </p>
            <EmailTestButton defaultTo={suggestedTest} />
          </section>
        )}

        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-600 font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-3 bg-sky-500 rounded" /> Notifications
          </p>
          <h2 className="font-heading text-xl font-bold text-text-primary mb-1">
            Où on vous prévient d&apos;une nouvelle commande&nbsp;?
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            À chaque nouvelle commande, un email arrive sur cette adresse.
            Elle est reprise de <strong>votre email de contact</strong>{" "}
            renseigné à l&apos;étape&nbsp;2.
          </p>
          <div className="rounded-2xl border border-border bg-bg-secondary/40 px-4 py-3 text-sm">
            {notifyEmail ? (
              <span className="text-text-primary font-mono">{notifyEmail}</span>
            ) : (
              <span className="text-amber-700">
                Aucun email renseigné — revenez à l&apos;étape « Société » pour
                le compléter.
              </span>
            )}
          </div>
        </section>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="email"
            nextPath="/admin/bienvenue/livraison"
            label={status.ready ? "Messagerie prête, continuer" : "Continuer"}
          />
        </div>
      </div>
    </div>
  );
}
