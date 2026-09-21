import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fr = JSON.parse(readFileSync(join(root, "messages/fr.json"), "utf8"));
const en = JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"));

describe("Service Client — labels & structure", () => {
  describe("messages/fr.json", () => {
    it("expose 'Service Client' dans la navigation", () => {
      expect(fr.nav.claims).toBe("Service Client");
    });

    it("titre + breadcrumb + meta utilisent Service Client", () => {
      expect(fr.claims.title).toBe("Service Client");
      expect(fr.claims.breadcrumb).toBe("Service Client");
      expect(fr.claims.metaTitle).toContain("Service Client");
    });

    it("expose uniquement les 2 statuts OPEN/CLOSED côté client", () => {
      expect(fr.claims.statusOpen).toBe("Ouverte");
      expect(fr.claims.statusClosed).toBe("Fermée");
      // Les anciens statuts ne doivent plus exister
      expect(fr.claims.statusInReview).toBeUndefined();
      expect(fr.claims.statusAccepted).toBeUndefined();
      expect(fr.claims.statusRejected).toBeUndefined();
      expect(fr.claims.statusResolved).toBeUndefined();
      expect(fr.claims.statusResolutionPending).toBeUndefined();
    });

    it("CTA contact utilise 'Contacter le service client'", () => {
      expect(fr.contact.openClaim).toBe("Contacter le service client");
    });
  });

  describe("messages/en.json", () => {
    it("uses Customer Service for the section", () => {
      expect(en.nav.claims).toBe("Customer Service");
      expect(en.claims.title).toBe("Customer Service");
    });

    it("exposes only 2 statuses", () => {
      expect(en.claims.statusOpen).toBe("Open");
      expect(en.claims.statusClosed).toBe("Closed");
      expect(en.claims.statusInReview).toBeUndefined();
    });
  });

  describe("Navigation admin", () => {
    it("AdminDesktopShell utilise 'Service Client'", () => {
      const shell = readFileSync(
        join(root, "components/admin/AdminDesktopShell.tsx"),
        "utf8",
      );
      expect(shell).toContain('label: "Service Client"');
    });

    it("AdminMobileNav utilise 'Service Client'", () => {
      const nav = readFileSync(
        join(root, "components/admin/AdminMobileNav.tsx"),
        "utf8",
      );
      expect(nav).toContain('label: "Service Client"');
    });
  });

  describe("Emails", () => {
    it("utilise 'Nouvelle demande (Service Client)' + template générique de réponse", () => {
      const notif = readFileSync(join(root, "lib/notifications.ts"), "utf8");
      expect(notif).toContain("Nouvelle demande (Service Client)");
      // Nouveau template unifié (chronomètre 5 min) : formulation figée avec
      // la cliente le 2026-09-21 — le mail ne contient plus le détail de la
      // réponse, pour forcer le client à revenir sur le site.
      expect(notif).toContain("Un administrateur vous a répondu");
      const withoutComments = notif
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(withoutComments).not.toContain("notifyClientClaimUpdate");
      // Les 2 anciens helpers séparés ont été fusionnés en un seul.
      expect(withoutComments).not.toContain("notifyClientNewReply");
      expect(withoutComments).not.toContain("notifyClientHasNewReply");
    });
  });
});
