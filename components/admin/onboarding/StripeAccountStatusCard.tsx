import type { StripeAccountInfo } from "@/lib/stripe";

type Props = { info: StripeAccountInfo };

/**
 * Encart de statut du compte Stripe branché.
 * 4 cas visuels : LIVE OK, TEST OK, mismatch clés (rouge), pas branché (orange).
 */
export default function StripeAccountStatusCard({ info }: Props) {
  if (info.mismatch) {
    return <MismatchCard info={info} />;
  }
  if (!info.configured || !info.account) {
    return <NotConfiguredCard info={info} />;
  }
  return <ConnectedCard info={info} />;
}

function ConnectedCard({ info }: { info: StripeAccountInfo }) {
  const acct = info.account!;
  const isTest = acct.testMode;

  return (
    <section
      className={`rounded-3xl border ${
        isTest ? "border-sky-200" : "border-emerald-200"
      } bg-gradient-to-br ${
        isTest ? "from-sky-50" : "from-emerald-50"
      } via-white to-white p-6 md:p-8 shadow-sm relative overflow-hidden`}
    >
      <div
        className={`absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl ${
          isTest ? "bg-sky-300/30" : "bg-emerald-300/30"
        }`}
      />
      <div className="relative">
        <p
          className={`text-[11px] uppercase tracking-[0.18em] font-semibold mb-3 flex items-center gap-2 ${
            isTest ? "text-sky-700" : "text-emerald-700"
          }`}
        >
          <span
            className={`w-1 h-3 rounded ${
              isTest ? "bg-sky-500" : "bg-emerald-500"
            }`}
          />
          Compte Stripe branché
        </p>
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl shadow-md ring-1 bg-gradient-to-br from-slate-900 to-slate-800 ${
              isTest ? "ring-sky-200" : "ring-emerald-200"
            }`}
          >
            {isTest ? "🧪" : "✅"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-heading text-xl font-bold text-text-primary truncate">
                {acct.name}
              </p>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                  isTest
                    ? "bg-sky-100 text-sky-800"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {isTest ? "TEST" : "LIVE"}
              </span>
            </div>
            <p className="text-sm text-text-secondary mt-0.5 truncate">
              {acct.email ?? "email non renseigné"} · compte{" "}
              <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                {acct.id}
              </code>
            </p>
            <p
              className={`text-sm font-medium mt-3 ${
                isTest ? "text-sky-800" : "text-emerald-800"
              }`}
            >
              {isTest
                ? "Mode TEST — aucun vrai paiement. Utilisez la carte 4242 4242 4242 4242 pour essayer."
                : "Vos clients peuvent payer par carte. Les paiements arrivent sur votre compte Stripe."}
            </p>
            {(!acct.chargesEnabled || !acct.payoutsEnabled) && (
              <p className="text-sm text-amber-700 font-medium mt-2">
                ⚠️{" "}
                {!acct.chargesEnabled
                  ? "Votre compte Stripe ne peut pas encore encaisser (dossier incomplet côté Stripe)."
                  : "Votre compte Stripe ne peut pas encore recevoir les virements (RIB à valider)."}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MismatchCard({ info }: { info: StripeAccountInfo }) {
  return (
    <section className="rounded-3xl border-2 border-rose-300 bg-gradient-to-br from-rose-50 via-white to-white p-6 md:p-8 shadow-sm relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl bg-rose-300/30" />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-[0.18em] text-rose-700 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-rose-500 rounded" /> Configuration Stripe
          incohérente
        </p>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-500 flex items-center justify-center text-white text-2xl shadow-md ring-1 ring-rose-200">
            ⚠️
          </div>
          <div className="flex-1">
            <p className="font-heading text-xl font-bold text-text-primary">
              Vos clés viennent de deux comptes différents
            </p>
            <p className="text-sm text-text-secondary mt-2">
              Vos clients ne pourront pas payer. Stripe rejettera les paiements
              car les clés ne matchent pas.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              <li className="flex items-center gap-2">
                <span className="text-rose-600 font-bold">•</span>
                <span className="text-text-primary">
                  Clé publique : compte{" "}
                  <code className="text-xs bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-semibold">
                    {info.publishableAccountPrefix ?? "?"}
                  </code>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-rose-600 font-bold">•</span>
                <span className="text-text-primary">
                  Clé secrète : compte{" "}
                  <code className="text-xs bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-semibold">
                    {info.secretAccountPrefix ?? "?"}
                  </code>
                </span>
              </li>
            </ul>
            <p className="text-sm text-rose-800 font-semibold mt-3">
              👉 Ressaisissez ci-dessous les 3 clés du bon compte Stripe.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotConfiguredCard({ info }: { info: StripeAccountInfo }) {
  const rows: { label: string; ok: boolean }[] = [
    { label: "Clé publique", ok: info.keysFromDb.hasPublishable },
    { label: "Clé secrète", ok: info.keysFromDb.hasSecret },
    { label: "Signature webhook", ok: info.keysFromDb.hasWebhook },
  ];
  return (
    <section className="rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-white p-6 md:p-8 shadow-sm relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl bg-amber-300/30" />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-[0.18em] text-amber-700 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-amber-500 rounded" /> Stripe pas encore
          branché
        </p>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center text-white text-2xl shadow-md ring-1 ring-amber-200">
            ⏳
          </div>
          <div className="flex-1">
            <p className="font-heading text-xl font-bold text-text-primary">
              Il manque des clés Stripe
            </p>
            <p className="text-sm text-text-secondary mt-2">
              Tant que vos 3 clés ne sont pas renseignées, vos clients verront
              un message « Paiement indisponible » au moment de payer.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {rows.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  <span
                    className={r.ok ? "text-emerald-600" : "text-rose-600"}
                  >
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span className="text-text-primary">{r.label}</span>
                </li>
              ))}
            </ul>
            {info.accountError && (
              <p className="text-xs text-amber-800/80 mt-3">
                Stripe a renvoyé : {info.accountError}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
