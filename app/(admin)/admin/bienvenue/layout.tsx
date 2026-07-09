import type { Metadata } from "next";
import { headers } from "next/headers";
import WizardShell from "@/components/admin/onboarding/WizardShell";
import { getOnboardingStatus, ONBOARDING_STEPS } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Bienvenue — Configuration de votre boutique",
  robots: { index: false, follow: false },
};

// Ordre des etapes du wizard, hors "done" qui est un ecran final rendu par
// la page de l'etape 8 elle-meme (pas un onglet dans la sidebar).
export const WIZARD_STEP_ORDER = ONBOARDING_STEPS.filter((s) => s !== "done");

export const WIZARD_STEP_META: Record<
  (typeof WIZARD_STEP_ORDER)[number] | "done",
  { title: string; subtitle: string; path: string; accent: string }
> = {
  welcome:  { title: "Bienvenue",           subtitle: "Découverte",          path: "/admin/bienvenue",           accent: "violet"  },
  company:  { title: "Votre société",       subtitle: "SIRET, adresse",      path: "/admin/bienvenue/societe",   accent: "emerald" },
  brand:    { title: "Logo & couleur",      subtitle: "Identité visuelle",   path: "/admin/bienvenue/marque",    accent: "violet"  },
  stripe:   { title: "Encaissement",        subtitle: "Stripe",              path: "/admin/bienvenue/stripe",    accent: "amber"   },
  email:    { title: "E-mails",             subtitle: "Boîte pro",           path: "/admin/bienvenue/email",     accent: "sky"     },
  shipping: { title: "Livraison",           subtitle: "Easy-Express",        path: "/admin/bienvenue/livraison", accent: "rose"    },
  legal:    { title: "CGV & légal",         subtitle: "Documents",           path: "/admin/bienvenue/legal",     accent: "slate"   },
  done:     { title: "C'est prêt !",        subtitle: "Récap final",         path: "/admin/bienvenue/done",      accent: "emerald" },
};

export default async function WizardLayout({ children }: { children: React.ReactNode }) {
  const [status, h] = await Promise.all([getOnboardingStatus(), headers()]);
  const currentPath = h.get("x-current-path") ?? "/admin/bienvenue";

  return (
    <WizardShell
      currentPath={currentPath}
      stepsCompleted={status.stepsCompleted}
    >
      {children}
    </WizardShell>
  );
}
