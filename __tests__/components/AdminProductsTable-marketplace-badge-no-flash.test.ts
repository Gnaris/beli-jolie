import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Régression : après un publish marketplace réussi, il y avait une fenêtre
// (~800ms de debounce + aller-retour serveur) où le badge dans le tableau
// admin repassait "non publié" (fond rouge cliquable) avant de devenir vert.
//
// Cause : `MarketplaceBadge` / `AnkorstoreBadge` / `EfashionBadge` recevaient
// `published` depuis la donnée RSC (`product.pfsProductId`), pas depuis l'état
// dérivé `pfsBadgeState.online` qui prend en compte `justPublishedOk` (op done
// avec outcome ok, même si router.refresh n'a pas encore rapatrié le nouvel id).
//
// Fix : brancher `published` sur `xxxBadgeState.online` pour les 4 marketplaces
// (Faire le faisait déjà). Idem pour la condition `onActionClick` (ne pas
// ouvrir la modale « Publier » si on vient juste de publier avec succès).

const SRC = readFileSync(
  resolve(__dirname, "../../components/admin/products/AdminProductsTable.tsx"),
  "utf8",
);

describe("AdminProductsTable — pas de flash rouge entre op done et RSC refresh", () => {
  it("MarketplaceBadge (PFS) reçoit published depuis pfsBadgeState.online", () => {
    expect(SRC).toMatch(/<MarketplaceBadge[\s\S]{0,200}published=\{pfsBadgeState\.online\}/);
    expect(SRC).not.toMatch(/<MarketplaceBadge[\s\S]{0,200}published=\{!!product\.pfsProductId\}/);
  });

  it("AnkorstoreBadge reçoit published depuis ankorstoreBadgeState.online", () => {
    expect(SRC).toMatch(/<AnkorstoreBadge[\s\S]{0,200}published=\{ankorstoreBadgeState\.online\}/);
    expect(SRC).not.toMatch(/<AnkorstoreBadge[\s\S]{0,200}published=\{!!product\.ankorsProductId\}/);
  });

  it("EfashionBadge reçoit linked depuis efashionBadgeState.online", () => {
    expect(SRC).toMatch(/<EfashionBadge[\s\S]{0,200}linked=\{efashionBadgeState\.online\}/);
    // Ancienne mauvaise valeur : linked={efashionLinked} (donnée RSC brute)
    expect(SRC).not.toMatch(/<EfashionBadge[\s\S]{0,200}linked=\{efashionLinked\}/);
  });

  it("FaireBadge continue de recevoir published depuis faireBadgeState.online (déjà OK avant fix)", () => {
    expect(SRC).toMatch(/<FaireBadge[\s\S]{0,200}published=\{faireBadgeState\.online\}/);
  });

  it("le onActionClick des 3 badges corrigés teste !xxxBadgeState.online (pas !product.xxx)", () => {
    expect(SRC).toMatch(/hasPfsConfig && !pfsBadgeState\.online && !isPfsPublishing/);
    expect(SRC).toMatch(/showAnkorstore && !ankorstoreBadgeState\.online && !isAnkorstorePublishing/);
    expect(SRC).toMatch(/showEfashion && !efashionBadgeState\.online && !isEfashionPublishing/);
  });

  it("les MpDot mobiles (< lg) utilisent aussi xxxBadgeState.online", () => {
    // Sur mobile/tablet on affichait un aperçu compact qui souffrait du même bug.
    expect(SRC).toMatch(/<MpDot label="PFS"[\s\S]{0,120}active=\{hasPfsConfig && pfsBadgeState\.online\}/);
    expect(SRC).toMatch(/<MpDot label="EF"[\s\S]{0,120}active=\{efashionBadgeState\.online\}/);
    expect(SRC).toMatch(/<MpDot label="AK"[\s\S]{0,120}active=\{ankorstoreBadgeState\.online\}/);
  });

  it("les 3 badges ajoutent !xxxBadgeState.justPublishedOk pour ne pas flasher orange non plus", () => {
    // Après un publish/resync réussi, product.pfsSyncRequired peut être encore
    // stale dans les props RSC — on doit le masquer tant que justPublishedOk est vrai.
    expect(SRC).toMatch(/pfsSyncRequired && !isPfsPublishing && !pfsBadgeState\.justPublishedOk/);
    expect(SRC).toMatch(/ankorsSyncRequired && !isAnkorstorePublishing && !ankorstoreBadgeState\.justPublishedOk/);
    expect(SRC).toMatch(/efashionSyncRequired && !isEfashionPublishing && !efashionBadgeState\.justPublishedOk/);
  });
});
