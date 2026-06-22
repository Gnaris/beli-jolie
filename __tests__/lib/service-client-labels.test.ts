import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fr = JSON.parse(readFileSync(join(root, "messages/fr.json"), "utf8"));
const en = JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"));

describe("Renommage Réclamations → Service Client", () => {
  describe("messages/fr.json", () => {
    it("expose 'Service Client' dans la navigation", () => {
      expect(fr.nav.claims).toBe("Service Client");
    });

    it("titre + breadcrumb + meta utilisent Service Client", () => {
      expect(fr.claims.title).toBe("Service Client");
      expect(fr.claims.breadcrumb).toBe("Service Client");
      expect(fr.claims.metaTitle).toContain("Service Client");
    });

    it("élément individuel utilise 'demande'", () => {
      expect(fr.claims.newClaim).toBe("Nouvelle demande");
      expect(fr.claims.empty).toBe("Aucune demande");
      expect(fr.claimForm.typeTitle).toBe("Type de demande");
      expect(fr.claimForm.submit).toBe("Envoyer la demande");
    });

    it("CTA contact utilise 'Contacter le service client'", () => {
      expect(fr.contact.openClaim).toBe("Contacter le service client");
    });

    it("aucune chaîne FR visible ne contient encore 'réclamation' dans la section claims", () => {
      const claimsText = JSON.stringify(fr.claims) + JSON.stringify(fr.claimForm);
      expect(claimsText.toLowerCase()).not.toContain("réclamation");
      expect(claimsText.toLowerCase()).not.toContain("reclamation");
    });
  });

  describe("messages/en.json", () => {
    it("uses Customer Service for the section", () => {
      expect(en.nav.claims).toBe("Customer Service");
      expect(en.claims.title).toBe("Customer Service");
      expect(en.claims.breadcrumb).toBe("Customer Service");
    });

    it("uses 'request' for individual items", () => {
      expect(en.claims.newClaim).toBe("New request");
      expect(en.claims.empty).toBe("No requests");
      expect(en.claimForm.submit).toBe("Submit the request");
    });

    it("no displayed English value still contains 'claim'", () => {
      const allValues = [
        ...Object.values(en.claims as Record<string, string>),
        ...Object.values(en.claimForm as Record<string, string>),
      ].join(" ");
      expect(allValues.toLowerCase()).not.toContain("claim");
    });
  });

  describe("Navigation admin", () => {
    it("AdminDesktopShell utilise 'Service Client'", () => {
      const shell = readFileSync(
        join(root, "components/admin/AdminDesktopShell.tsx"),
        "utf8",
      );
      expect(shell).toContain('label: "Service Client"');
      expect(shell).not.toMatch(/label:\s*"Réclamations"/);
    });

    it("AdminMobileNav utilise 'Service Client'", () => {
      const nav = readFileSync(
        join(root, "components/admin/AdminMobileNav.tsx"),
        "utf8",
      );
      expect(nav).toContain('label: "Service Client"');
      expect(nav).not.toMatch(/label:\s*"Réclamations"/);
    });
  });

  describe("Pages admin", () => {
    it("liste admin affiche 'Service Client' comme titre H1", () => {
      const page = readFileSync(
        join(root, "app/(admin)/admin/reclamations/page.tsx"),
        "utf8",
      );
      expect(page).toContain(">Service Client<");
      expect(page).toContain('title: "Service Client — Admin"');
    });

    it("page détail admin a metadata 'Demande'", () => {
      const page = readFileSync(
        join(root, "app/(admin)/admin/reclamations/[id]/page.tsx"),
        "utf8",
      );
      expect(page).toContain('title: "Demande — Admin"');
      expect(page).toContain("Retour au service client");
    });
  });

  describe("Emails", () => {
    it("emails utilisent 'demande' / 'Service Client', plus 'réclamation' visible", () => {
      const notif = readFileSync(join(root, "lib/notifications.ts"), "utf8");
      expect(notif).toContain("Nouvelle demande (Service Client)");
      expect(notif).toContain("Examiner la demande");
      expect(notif).toContain("Voir la demande");

      // Retire les blocs de commentaires /* ... */ et // ... avant de
      // chercher "réclamation" dans des chaînes affichées à l'utilisateur.
      const withoutBlockComments = notif.replace(/\/\*[\s\S]*?\*\//g, "");
      const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
      expect(withoutLineComments.toLowerCase()).not.toContain("réclamation");
    });
  });
});
