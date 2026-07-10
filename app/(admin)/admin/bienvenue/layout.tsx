import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import WizardShell from "@/components/admin/onboarding/WizardShell";
import { getOnboardingStatus, ONBOARDING_STEPS } from "@/lib/onboarding";
import { getCompanyInfo } from "@/app/actions/admin/company-info";

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
  const [status, h, company] = await Promise.all([
    getOnboardingStatus(),
    headers(),
    getCompanyInfo(),
  ]);
  const currentPath = h.get("x-current-path") ?? "/admin/bienvenue";
  const initialShopName = company?.shopName?.trim() ?? "";

  // Étape "en cours" = première étape non complétée dans l'ordre du wizard.
  // Sert à la fois pour la redirection depuis la page racine ET pour bloquer
  // les accès directs à une étape future via l'URL (parcours linéaire strict).
  const currentStepId = WIZARD_STEP_ORDER.find(
    (s) => !status.stepsCompleted.includes(s),
  );
  const currentStepPath = currentStepId
    ? WIZARD_STEP_META[currentStepId].path
    : "/admin/bienvenue/done";

  // Reprise auto : /admin/bienvenue → étape en cours (après reconnexion).
  // Verrouillage welcome : dès qu'il est validé, on ne peut plus y revenir.
  if (currentPath === "/admin/bienvenue" && status.stepsCompleted.includes("welcome")) {
    redirect(currentStepPath);
  }

  // Blocage des étapes futures : si l'utilisatrice tape une URL d'étape au-delà
  // de son étape en cours, on la ramène à l'étape en cours. On autorise les
  // étapes déjà complétées (elles ne s'ouvrent pas depuis la sidebar mais
  // restent accessibles pour relecture éventuelle) et la page "done".
  if (currentStepId) {
    const currentIdx = WIZARD_STEP_ORDER.indexOf(currentStepId);
    const requestedStep = WIZARD_STEP_ORDER.find(
      (s) =>
        currentPath === WIZARD_STEP_META[s].path ||
        currentPath.startsWith(`${WIZARD_STEP_META[s].path}/`),
    );
    if (requestedStep) {
      const requestedIdx = WIZARD_STEP_ORDER.indexOf(requestedStep);
      if (requestedIdx > currentIdx) {
        redirect(currentStepPath);
      }
    }
  }

  return (
    <WizardShell
      currentPath={currentPath}
      stepsCompleted={status.stepsCompleted}
      initialShopName={initialShopName}
    >
      {children}
    </WizardShell>
  );
}
