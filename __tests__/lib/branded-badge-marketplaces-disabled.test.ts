/**
 * Régression : le badge « Réf » ne doit plus être envoyé à Ankorstore ni à
 * Faire (décision cliente 2026-07-30 — ces deux plateformes n'affichent pas
 * le badge dans leurs vignettes malgré plusieurs correctifs de dimensions).
 *
 * Le toggle DB `branded_reference_badge_enabled` reste actif pour la boutique
 * publique + PFS + eFashion.
 *
 * Ce test lit la source des 4 fichiers concernés et vérifie qu'ils n'ont plus
 * de lecture SiteConfig sur cette clé — sans ça, un futur revert (ou un
 * copier-coller depuis PFS) pourrait rebrancher le badge silencieusement.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [
  "lib/ankorstore-publish.ts",
  "lib/ankorstore-update.ts",
  "lib/faire-publish.ts",
  "lib/faire-update.ts",
] as const;

describe("badge « Réf » désactivé pour Ankorstore et Faire", () => {
  for (const relPath of FILES) {
    it(`${relPath} ne lit plus SiteConfig[branded_reference_badge_enabled]`, () => {
      const source = readFileSync(resolve(process.cwd(), relPath), "utf-8");
      expect(
        source,
        `${relPath} contient encore une lecture DB du toggle badge — ` +
          "Ankor/Faire doivent forcer brandedBadgeEnabled=false.",
      ).not.toContain('key: "branded_reference_badge_enabled"');
    });

    it(`${relPath} pose explicitement brandedBadgeEnabled = false`, () => {
      const source = readFileSync(resolve(process.cwd(), relPath), "utf-8");
      expect(
        source,
        `${relPath} doit avoir "const brandedBadgeEnabled = false;" ` +
          "pour prouver que la désactivation est intentionnelle.",
      ).toMatch(/const\s+brandedBadgeEnabled\s*=\s*false\s*;/);
    });
  }
});
