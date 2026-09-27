import { prisma } from "@/lib/prisma";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import FaviconConfig from "@/components/admin/settings/FaviconConfig";

export const dynamic = "force-dynamic";

export default async function BrandStepPage() {
  const faviconRow = await prisma.siteConfig.findFirst({ where: { key: "site_favicon" } });

  let currentFavicon: { icon: string; appleIcon: string } | null = null;
  if (faviconRow?.value) {
    try {
      const parsed = JSON.parse(faviconRow.value);
      if (parsed && typeof parsed.icon === "string" && typeof parsed.appleIcon === "string") {
        currentFavicon = { icon: parsed.icon, appleIcon: parsed.appleIcon };
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6">
      <WizardStepHeader
        emoji="🎨"
        eyebrow="Étape 3 — Identité visuelle"
        title="Votre icône de site"
        description={
          <>
            Petite image affichée dans l&apos;onglet du navigateur et à côté du
            site dans les résultats Google.
          </>
        }
        accent="violet"
      />

      <div className="space-y-6">
        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center text-2xl">
              🏷️
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                Icône du site
              </p>
              <p className="text-sm text-text-secondary">
                Petit carré affiché dans l&apos;onglet du navigateur et sur Google.
              </p>
            </div>
          </div>
          <FaviconConfig currentFavicon={currentFavicon} />
          <p className="text-xs text-text-secondary/70 mt-4">
            💡 Pas d&apos;icône&nbsp;? Vos initiales sont générées automatiquement.
            Vous pourrez toujours en ajouter une plus tard.
          </p>
        </section>

        <div className="flex justify-end pt-2">
          <WizardContinueButton
            step="brand"
            nextPath="/admin/bienvenue/stripe"
            label="Continuer"
          />
        </div>
      </div>
    </div>
  );
}
