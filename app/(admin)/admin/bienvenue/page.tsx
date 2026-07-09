import Link from "next/link";
import { getCachedShopName } from "@/lib/cached-data";
import WelcomeStartButton from "@/components/admin/onboarding/WelcomeStartButton";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const shopName = await getCachedShopName();
  return (
    <div className="text-center py-6 md:py-10">
      <div className="inline-flex w-20 h-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 text-5xl mb-6 shadow-sm">
        👋
      </div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3">
        Bienvenue
      </p>
      <h1 className="font-heading text-4xl md:text-5xl font-bold text-text-primary mb-4">
        {shopName ? `${shopName} est prête.` : "Votre boutique est prête."}
      </h1>
      <p className="text-lg text-text-secondary max-w-xl mx-auto mb-10">
        On va la configurer ensemble en <strong>5 à 10 minutes</strong>.
        Vous pourrez tout modifier plus tard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto text-left mb-10">
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mb-2 text-lg">🏢</div>
          <p className="font-semibold text-text-primary text-sm">Votre société</p>
          <p className="text-xs text-text-secondary">SIRET, adresse, TVA</p>
        </div>
        <div className="p-4 rounded-2xl bg-violet-50 border border-violet-100">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-2 text-lg">🎨</div>
          <p className="font-semibold text-text-primary text-sm">Votre marque</p>
          <p className="text-xs text-text-secondary">Logo + couleur</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center mb-2 text-lg">💳</div>
          <p className="font-semibold text-text-primary text-sm">Encaissement</p>
          <p className="text-xs text-text-secondary">Stripe pour être payée</p>
        </div>
      </div>

      <WelcomeStartButton />

      <p className="text-sm text-text-secondary/70 mt-6">
        Aucune étape n'est bloquante — vous pouvez tout passer et revenir plus tard.
      </p>

      <div className="mt-8 text-xs text-text-secondary/60">
        <Link href="/admin/bienvenue/societe" className="hover:underline">
          Passer directement à la configuration →
        </Link>
      </div>
    </div>
  );
}
