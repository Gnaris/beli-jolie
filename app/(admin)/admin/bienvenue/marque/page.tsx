import { prisma } from "@/lib/prisma";
import WizardStepHeader from "@/components/admin/onboarding/WizardStepHeader";
import WizardContinueButton from "@/components/admin/onboarding/WizardContinueButton";
import FaviconConfig from "@/components/admin/settings/FaviconConfig";
import BannerImageConfig from "@/components/admin/settings/BannerImageConfig";

export const dynamic = "force-dynamic";

export default async function BrandStepPage() {
  const [faviconRow, bannerRow] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "site_favicon" } }),
    prisma.siteConfig.findUnique({ where: { key: "banner_image" } }),
  ]);

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
        title="Votre logo et votre bannière"
        description={
          <>
            Deux images pour habiller votre boutique&nbsp;: la petite icône dans
            l&apos;onglet du navigateur et la grande photo qui accueille vos
            clients sur la page d&apos;accueil.
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

        <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl">
              🖼️
            </div>
            <div>
              <p className="font-heading text-lg font-bold text-text-primary">
                Bannière d&apos;accueil
              </p>
              <p className="text-sm text-text-secondary">
                Grande photo en haut de la page d&apos;accueil de votre boutique.
              </p>
            </div>
          </div>
          <BannerImageConfig currentImage={bannerRow?.value ?? null} />
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
