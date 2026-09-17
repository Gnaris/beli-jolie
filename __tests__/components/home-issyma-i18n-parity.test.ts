import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Refonte 2026-09-17 des sections sous le hero Issyma (bandeau reassurance,
// nouveautes, categories, best sellers, engagement, FAQ, CTA). Chaque
// nouvelle chaine referencee par HomeIssymaLayout.tsx doit exister a la
// fois en FR (source) et en EN (miroir), sinon le rendu casse quand la
// cliente switche la langue.

const REPO_ROOT = path.resolve(__dirname, "../..");
const fr = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "messages/fr.json"), "utf8")) as {
  home: { issyma: Record<string, string> };
};
const en = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "messages/en.json"), "utf8")) as {
  home: { issyma: Record<string, string> };
};

// Clés nouvellement ajoutées lors de la refonte. Toute suppression future
// doit casser ce test — c'est le filet de sécurité pour le switch EN.
const NEW_KEYS = [
  "stat1Title", "stat1Desc",
  "stat2Title", "stat2Desc",
  "stat3Title", "stat3Desc",
  "stat4Title", "stat4Desc",
  "newSimpleTitle", "newSeeAll", "badgeNew",
  "catSimpleTitle", "catSeeAll", "catProductsCount",
  "catFeatureEyebrow", "catFeatureDesc",
  "bsSimpleEyebrow", "bsSimpleTitle", "bsSeeAll",
  "reviewsSimpleEyebrow", "reviewsSimpleTitle", "reviewsSeeAll",
  "faqSimpleEyebrow", "faqSimpleTitle",
  "ctaSimpleDesc", "ctaSimpleBtn1", "ctaSimpleBtn2",
] as const;

describe("HomeIssymaLayout — parité i18n FR / EN", () => {
  it("expose toutes les nouvelles clés Issyma en FR", () => {
    for (const key of NEW_KEYS) {
      expect(fr.home.issyma[key], `clé manquante en FR : issyma.${key}`).toBeTruthy();
    }
  });

  it("expose toutes les nouvelles clés Issyma en EN (miroir)", () => {
    for (const key of NEW_KEYS) {
      expect(en.home.issyma[key], `clé manquante en EN : issyma.${key}`).toBeTruthy();
    }
  });

  it("aucune clé Issyma FR n'est orpheline côté EN", () => {
    const frKeys = Object.keys(fr.home.issyma).sort();
    const enKeys = Object.keys(en.home.issyma).sort();
    expect(enKeys).toEqual(frKeys);
  });

  it("catProductsCount conserve le placeholder {count} dans les deux langues", () => {
    expect(fr.home.issyma.catProductsCount).toContain("{count}");
    expect(en.home.issyma.catProductsCount).toContain("{count}");
  });

  it("ctaSimpleDesc conserve le placeholder {shopName} dans les deux langues", () => {
    expect(fr.home.issyma.ctaSimpleDesc).toContain("{shopName}");
    expect(en.home.issyma.ctaSimpleDesc).toContain("{shopName}");
  });
});

describe("HomeIssymaLayout — clés référencées dans le layout", () => {
  const layoutSrc = fs.readFileSync(
    path.join(REPO_ROOT, "components/home/layouts/HomeIssymaLayout.tsx"),
    "utf8",
  );

  it("chaque nouvelle clé est bien référencée dans HomeIssymaLayout.tsx", () => {
    for (const key of NEW_KEYS) {
      // Les statN et engSimpleN sont referencees dynamiquement via template
      // string — on cherche donc soit `issyma.<key>` textuel, soit le prefix
      // template correspondant (statNTitle -> issyma.stat, engSimpleN -> issyma.engSimple).
      const literal = `issyma.${key}`;
      const templateStat = /^stat[1-4](Title|Desc)$/.test(key) ? "issyma.stat" : null;

      const found =
        layoutSrc.includes(literal) ||
        (templateStat != null && layoutSrc.includes(templateStat));

      expect(found, `clé jamais référencée dans le layout : ${literal}`).toBe(true);
    }
  });
});
