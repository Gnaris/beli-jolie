import { getCachedShopName } from "@/lib/cached-data";
import WelcomePasswordForm from "@/components/admin/onboarding/WelcomePasswordForm";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const shopName = await getCachedShopName();
  return (
    <div className="max-w-2xl mx-auto py-6 md:py-10">
      <div className="text-center mb-8">
        <div className="inline-flex w-20 h-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 text-5xl mb-6 shadow-sm">
          👋
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3">
          Bienvenue
        </p>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-3">
          {shopName ? `${shopName} est prête.` : "Votre boutique est prête."}
        </h1>
        <p className="text-lg text-text-secondary max-w-md mx-auto">
          Première étape&nbsp;: <strong>sécurisez votre compte</strong> en choisissant
          un mot de passe qui vous est propre.
        </p>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-violet-50/60 via-white to-indigo-50/60 border border-violet-100 p-6 md:p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center text-2xl">🔒</div>
          <div>
            <p className="font-heading text-lg font-bold text-text-primary">Sécurisez votre compte</p>
            <p className="text-sm text-text-secondary">
              Remplacez le mot de passe temporaire qu'on vous a envoyé.
            </p>
          </div>
        </div>

        <WelcomePasswordForm />

        <p className="text-xs text-text-secondary/70 mt-4 text-center">
          🔐 Votre mot de passe est chiffré (bcrypt) — même nous ne pouvons pas le lire.
          Le mot de passe de votre boîte mail reste inchangé.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mb-2 text-lg">🏢</div>
          <p className="font-semibold text-text-primary text-sm">Ensuite&nbsp;: société</p>
          <p className="text-xs text-text-secondary">SIRET, adresse, TVA</p>
        </div>
        <div className="p-4 rounded-2xl bg-violet-50 border border-violet-100">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-2 text-lg">🎨</div>
          <p className="font-semibold text-text-primary text-sm">Puis&nbsp;: marque</p>
          <p className="text-xs text-text-secondary">Logo + couleur</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center mb-2 text-lg">💳</div>
          <p className="font-semibold text-text-primary text-sm">Enfin&nbsp;: encaissement</p>
          <p className="text-xs text-text-secondary">Stripe pour être payée</p>
        </div>
      </div>
    </div>
  );
}
