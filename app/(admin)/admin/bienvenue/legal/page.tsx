import { prisma } from "@/lib/prisma";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import LegalGenerateButton from "@/components/admin/onboarding/LegalGenerateButton";

export const dynamic = "force-dynamic";

export default async function LegalStepPage() {
  const [docsCount, companyInfo] = await Promise.all([
    prisma.legalDocument.count(),
    prisma.companyInfo.findFirst(),
  ]);

  const hasCompany = !!companyInfo?.name?.trim();

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="📜"
        eyebrow="Étape 7 — CGV & mentions légales"
        title="Les documents obligatoires de votre boutique"
        description={
          <>
            La loi impose d&apos;afficher <strong>CGV</strong> (conditions de
            vente), <strong>CGU</strong> (utilisation du site) et
            <strong> mentions légales</strong>. On les génère
            automatiquement à partir de votre société.
          </>
        }
        accent="slate"
      />

      <div className="space-y-6">
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-2xl">
              📄
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                Générer vos documents
              </p>
              <p className="text-sm text-text-secondary">
                Trois documents créés d&apos;un coup, prêts à publier.
              </p>
            </div>
          </div>

          {!hasCompany && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mb-4">
              <p className="font-semibold">⚠️ Vos informations société ne sont pas complètes</p>
              <p className="mt-0.5">
                Les documents seront générés mais les blancs seront visibles.
                Revenez à l&apos;étape « Société » pour tout remplir.
              </p>
            </div>
          )}

          <LegalGenerateButton initialCount={docsCount} />

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border p-4">
              <div className="text-2xl mb-1">🛒</div>
              <p className="font-semibold text-sm text-text-primary">
                CGV
              </p>
              <p className="text-xs text-text-secondary/70">
                Conditions de vente
              </p>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <div className="text-2xl mb-1">🖥️</div>
              <p className="font-semibold text-sm text-text-primary">
                CGU
              </p>
              <p className="text-xs text-text-secondary/70">
                Utilisation du site
              </p>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <div className="text-2xl mb-1">⚖️</div>
              <p className="font-semibold text-sm text-text-primary">
                Mentions légales
              </p>
              <p className="text-xs text-text-secondary/70">
                Éditeur, hébergeur
              </p>
            </div>
          </div>
        </section>

        <div className="rounded-2xl bg-slate-50/60 border border-slate-200 p-4 text-sm text-slate-700">
          <p className="font-semibold mb-1">💡 Modifiables à tout moment</p>
          <p>
            Vous pourrez retoucher chaque document depuis <strong>Admin
            &rsaquo; Documents légaux</strong>. Chaque modification garde un
            historique&nbsp;: on peut revenir en arrière si besoin.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="legal"
            nextPath="/admin/bienvenue/done"
            label="Continuer"
          />
        </div>
      </div>
    </div>
  );
}
