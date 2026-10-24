/**
 * Carousel « Les tendances du moment » — règles d'affichage.
 *
 * Côté home, la section Tendances :
 *   - est rendue UNIQUEMENT dans HomeBeliandjolieLayout (jamais Issyma)
 *   - est placée AU-DESSUS du bloc Nouveautés (demande cliente 2026-10-24)
 *   - utilise l'id d'ancrage `home-tendances` et les clés i18n `trends*`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const beliLayout = readFileSync(
  resolve(__dirname, "../../../components/home/layouts/HomeBeliandjolieLayout.tsx"),
  "utf-8",
);
const issymaLayout = readFileSync(
  resolve(__dirname, "../../../components/home/layouts/HomeIssymaLayout.tsx"),
  "utf-8",
);
const homePage = readFileSync(
  resolve(__dirname, "../../../app/[locale]/page.tsx"),
  "utf-8",
);

describe("Carousel « Tendances du moment »", () => {
  it("HomeBeliandjolieLayout contient la section Tendances avec les bonnes clés i18n", () => {
    expect(beliLayout).toContain("trendingCards");
    expect(beliLayout).toContain('"home-tendances"');
    expect(beliLayout).toContain('t("trends")');
    expect(beliLayout).toContain('t("trendsEyebrow")');
    expect(beliLayout).toContain('t("trendsMore")');
  });

  it("La section Tendances est rendue AVANT la section Nouveautés dans HomeBeliandjolieLayout", () => {
    const posTrendances = beliLayout.indexOf("home-tendances");
    const posNouveautes = beliLayout.indexOf("home-nouveautes");
    expect(posTrendances).toBeGreaterThan(-1);
    expect(posNouveautes).toBeGreaterThan(-1);
    expect(posTrendances).toBeLessThan(posNouveautes);
  });

  it("HomeIssymaLayout ne consomme pas trendingCards (carousel exclusif BJ)", () => {
    // L'ancre et le texte "home-tendances" ne doivent apparaître nulle part
    expect(issymaLayout).not.toContain("home-tendances");
    expect(issymaLayout).not.toContain('t("trends")');
  });

  it("La home charge les produits tendance triés par trendingSince desc + fallback createdAt", () => {
    expect(homePage).toContain("isTrending: true");
    expect(homePage).toContain("trendingSince");
    // Fallback explicite sur createdAt pour garantir un ordre stable
    expect(homePage).toMatch(/trendingSince[\s\S]{0,200}createdAt/);
  });

  it("La home skippe le fetch tendance côté Issyma (évite requête inutile)", () => {
    // Le fetch ne s'exécute que si tenant !== issyma — vérifié par la présence
    // du bloc conditionnel qui précède trendingPromise.
    expect(homePage).toMatch(/trendingPromise\s*=\s*\n?\s*layoutChoice\s*===\s*"issyma"/);
  });
});
