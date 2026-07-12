import { prisma } from "@/lib/prisma";
import { getOnboardingStatus } from "@/lib/onboarding";
import { getCachedShopName } from "@/lib/cached-data";
import { getStripeConfigStatus } from "@/lib/stripe";
import { getSmtpConfigStatus } from "@/lib/email";
import DoneStepButton from "@/components/admin/onboarding/DoneStepButton";

export const dynamic = "force-dynamic";

type Check = {
  key: string;
  emoji: string;
  label: string;
  ok: boolean;
  hint?: string;
};

export default async function DoneStepPage() {
  const [
    status,
    shopName,
    company,
    faviconRow,
    bannerRow,
    eeRow,
    docsCount,
    stripeStatus,
    smtpStatus,
  ] = await Promise.all([
    getOnboardingStatus(),
    getCachedShopName().catch(() => ""),
    prisma.companyInfo.findFirst(),
    prisma.siteConfig.findFirst({ where: { key: "site_favicon" } }),
    prisma.siteConfig.findFirst({ where: { key: "banner_image" } }),
    prisma.siteConfig.findFirst({
      where: { key: "easy_express_api_key" },
      select: { key: true },
    }),
    prisma.legalDocument.count(),
    getStripeConfigStatus(),
    getSmtpConfigStatus(),
  ]);

  const stripeOk = stripeStatus.ready;
  const smtpOk = smtpStatus.ready;

  const checks: Check[] = [
    {
      key: "welcome",
      emoji: "🔒",
      label: "Mot de passe personnel",
      ok: status.stepsCompleted.includes("welcome"),
    },
    {
      key: "company",
      emoji: "🏢",
      label: "Informations société",
      ok: !!company?.name?.trim() && !!company.address?.trim(),
      hint: !company?.name?.trim() ? "Raison sociale manquante" : undefined,
    },
    {
      key: "brand",
      emoji: "🎨",
      label: "Icône et bannière",
      ok: !!faviconRow?.value || !!bannerRow?.value,
      hint:
        !faviconRow?.value && !bannerRow?.value
          ? "Aucune image ajoutée (facultatif)"
          : undefined,
    },
    {
      key: "stripe",
      emoji: "💳",
      label: "Encaissement Stripe",
      ok: stripeOk,
      hint: stripeOk ? undefined : "À brancher plus tard depuis .env",
    },
    {
      key: "email",
      emoji: "📬",
      label: "Envoi d'emails",
      ok: smtpOk,
      hint: smtpOk ? undefined : "SMTP non configuré",
    },
    {
      key: "shipping",
      emoji: "🚚",
      label: "Livraison Easy-Express",
      ok: !!eeRow,
      hint: !eeRow ? "Clé API non renseignée (facultatif)" : undefined,
    },
    {
      key: "legal",
      emoji: "📜",
      label: "CGV et mentions légales",
      ok: docsCount > 0,
      hint: docsCount === 0 ? "Documents non générés" : undefined,
    },
  ];

  const okCount = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const allGood = okCount === total;

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <div className="text-center mb-8">
        <div className="inline-flex w-24 h-24 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-100 via-teal-100 to-emerald-100 text-6xl mb-6 shadow-lg ring-1 ring-emerald-200">
          🎉
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-3">
          Étape 8 — C&apos;est prêt !
        </p>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-3">
          {shopName ? `${shopName} est configurée.` : "Votre boutique est configurée."}
        </h1>
        <p className="text-lg text-text-secondary max-w-xl mx-auto">
          {allGood
            ? "Tout est en place. Vous pouvez commencer à ajouter vos produits."
            : `${okCount} étape${okCount > 1 ? "s" : ""} sur ${total} validée${okCount > 1 ? "s" : ""}. Le reste peut se faire plus tard.`}
        </p>
      </div>

      <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-4 flex items-center gap-2">
          <span className="w-1 h-3 bg-emerald-500 rounded" /> Récapitulatif
        </p>
        <ul className="space-y-2">
          {checks.map((c) => (
            <li
              key={c.key}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl border border-border bg-bg-secondary/30"
            >
              <span
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-xl ${
                  c.ok
                    ? "bg-emerald-100 ring-1 ring-emerald-200"
                    : "bg-amber-100 ring-1 ring-amber-200"
                }`}
              >
                {c.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary text-sm">
                  {c.label}
                </p>
                {c.hint && (
                  <p className="text-xs text-text-secondary/80">{c.hint}</p>
                )}
              </div>
              <span
                className={`text-lg ${
                  c.ok ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {c.ok ? "✓" : "…"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl bg-gradient-to-br from-violet-50 via-white to-indigo-50 border border-violet-100 p-6 md:p-8 mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-violet-500 rounded" /> Prochaines actions
        </p>
        <h2 className="font-heading text-xl font-bold text-text-primary mb-4">
          Par où commencer&nbsp;?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white border border-border p-4">
            <div className="text-2xl mb-1">📦</div>
            <p className="font-semibold text-sm text-text-primary">
              Ajouter vos produits
            </p>
            <p className="text-xs text-text-secondary/80 mt-0.5">
              Un par un ou en masse depuis un fichier Excel.
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-border p-4">
            <div className="text-2xl mb-1">🎁</div>
            <p className="font-semibold text-sm text-text-primary">
              Vos catégories
            </p>
            <p className="text-xs text-text-secondary/80 mt-0.5">
              Organisez votre boutique par familles de produits.
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-border p-4">
            <div className="text-2xl mb-1">👥</div>
            <p className="font-semibold text-sm text-text-primary">
              Vos clients
            </p>
            <p className="text-xs text-text-secondary/80 mt-0.5">
              Approuvez les inscriptions et gérez les remises.
            </p>
          </div>
        </div>
      </section>

      <div className="flex justify-center pt-2">
        <DoneStepButton />
      </div>
    </div>
  );
}
