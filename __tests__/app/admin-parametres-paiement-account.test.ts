import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Onglet /admin/parametres > Paiement : la cliente doit pouvoir vérifier d'un
// coup d'œil à quel compte Stripe le site est relié (nom, mode LIVE/TEST,
// email). Sinon elle ne voit que « Mode LIVE » sans savoir de quelle société
// il s'agit — piège quand plusieurs boutiques partagent un même install.
//
// La carte StripeAccountStatusCard (composant partagé avec l'onboarding wizard)
// couvre les 3 cas visuels : connecté, mismatch clés, non configuré.

const SRC = readFileSync(
  resolve(__dirname, "../../app/(admin)/admin/parametres/page.tsx"),
  "utf8",
);

describe("PaiementTab — affichage du compte Stripe branché", () => {
  it("importe getStripeAccountInfo depuis lib/stripe", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*getStripeAccountInfo[^}]*\}\s*from\s*["']@\/lib\/stripe["']/);
  });

  it("importe le composant StripeAccountStatusCard", () => {
    expect(SRC).toMatch(
      /import\s+StripeAccountStatusCard\s+from\s+["']@\/components\/admin\/onboarding\/StripeAccountStatusCard["']/,
    );
  });

  it("appelle getStripeAccountInfo() dans PaiementTab", () => {
    const tabIndex = SRC.indexOf("async function PaiementTab()");
    expect(tabIndex).toBeGreaterThan(-1);
    const tabBody = SRC.slice(tabIndex, tabIndex + 2000);
    expect(tabBody).toMatch(/getStripeAccountInfo\(\)/);
  });

  it("rend <StripeAccountStatusCard info={...}/> dans PaiementTab", () => {
    const tabIndex = SRC.indexOf("async function PaiementTab()");
    const tabBody = SRC.slice(tabIndex, tabIndex + 3000);
    expect(tabBody).toMatch(/<StripeAccountStatusCard\s+info=\{[^}]+\}\s*\/>/);
  });
});
