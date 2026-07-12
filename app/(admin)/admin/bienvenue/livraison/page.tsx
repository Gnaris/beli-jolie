import { prisma } from "@/lib/prisma";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import EasyExpressApiKeyConfig from "@/components/admin/settings/EasyExpressApiKeyConfig";
import ShippingMarginConfig from "@/components/admin/settings/ShippingMarginConfig";

export const dynamic = "force-dynamic";

export default async function ShippingStepPage() {
  const [eeRow, marginTypeRow, marginValueRow] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { key: "easy_express_api_key" },
      select: { key: true },
    }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_type" } }),
    prisma.siteConfig.findFirst({ where: { key: "shipping_margin_value" } }),
  ]);

  const marginType =
    (marginTypeRow?.value as "fixed" | "percent") || "fixed";
  const marginValue = Number(marginValueRow?.value) || 0;
  const eeConnected = !!eeRow;

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="🚚"
        eyebrow="Étape 6 — Livraison"
        title="Expédiez vos commandes en quelques clics"
        description={
          <>
            On utilise <strong>Easy-Express</strong>&nbsp;: vous comparez les
            transporteurs (Colissimo, Mondial Relay, Chronopost…) et vous
            imprimez l&apos;étiquette directement depuis votre commande.
          </>
        }
        accent="rose"
      />

      <div className="space-y-6">
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-rose-100 flex items-center justify-center text-2xl">
              🔑
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                Votre clé Easy-Express
              </p>
              <p className="text-sm text-text-secondary">
                Collez votre jeton d&apos;accès pour connecter votre compte.
              </p>
            </div>
          </div>
          <EasyExpressApiKeyConfig hasKey={eeConnected} />
        </section>

        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center text-2xl">
              💰
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                Marge sur les frais de port
              </p>
              <p className="text-sm text-text-secondary">
                Ajoutez un montant fixe ou un pourcentage au tarif transporteur.
              </p>
            </div>
          </div>
          <ShippingMarginConfig
            initialType={marginType}
            initialValue={marginValue}
          />
        </section>

        <div className="rounded-2xl bg-rose-50/60 border border-rose-100 p-4 text-sm text-rose-800">
          <p className="font-semibold mb-1">💡 Pas encore de compte Easy-Express&nbsp;?</p>
          <p className="text-rose-800/80">
            Créez-le gratuitement sur{" "}
            <a
              href="https://easy-express.fr/inscription"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline font-semibold"
            >
              easy-express.fr/inscription
            </a>
            , puis récupérez votre jeton d&apos;accès dans <strong>Mes
            informations</strong>. Vous pouvez sauter cette étape et la faire
            plus tard&nbsp;: vos commandes fonctionneront quand même, elles
            seront juste marquées « En attente d&apos;expédition ».
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="shipping"
            nextPath="/admin/bienvenue/legal"
            label={eeConnected ? "Livraison branchée, continuer" : "Continuer"}
          />
        </div>
      </div>
    </div>
  );
}
