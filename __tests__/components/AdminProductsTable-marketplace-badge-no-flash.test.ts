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
    // La garde amont peut être hasXxxConfig ou xxxOperational (kill switch tenant +
    // maintenance plateforme) — on vérifie juste la partie état badge.
    expect(SRC).toMatch(/!pfsBadgeState\.online && !isPfsPublishing/);
    expect(SRC).toMatch(/!ankorstoreBadgeState\.online && !isAnkorstorePublishing/);
    expect(SRC).toMatch(/!efashionBadgeState\.online && !isEfashionPublishing/);
  });

  it("les MpDot mobiles (< lg) utilisent aussi xxxBadgeState.online", () => {
    // Sur mobile/tablet on affichait un aperçu compact qui souffrait du même bug.
    expect(SRC).toMatch(/<MpDot label="PFS"[\s\S]{0,120}active=\{hasPfsConfig && pfsBadgeState\.online\}/);
    expect(SRC).toMatch(/<MpDot label="EF"[\s\S]{0,120}active=\{efashionBadgeState\.online\}/);
    expect(SRC).toMatch(/<MpDot label="AK"[\s\S]{0,120}active=\{ankorstoreBadgeState\.online\}/);
  });

  it("les 4 badges lisent syncRequired depuis xxxBadgeState.syncRequired (fenêtre de grâce 5s post-sync)", () => {
    // Après une sync réussie (mode publish/refresh/resync), product.xxxSyncRequired
    // peut être encore stale dans les props RSC le temps du router.refresh —
    // xxxBadgeState.syncRequired intègre déjà la fenêtre de grâce completedRecentlyOk
    // qui couvre les 3 modes, contrairement à justPublishedOk qui ne couvre que publish.
    expect(SRC).toMatch(/syncRequired=\{pfsBadgeState\.syncRequired && !pendingPfsEnqueue\}/);
    expect(SRC).toMatch(/syncRequired=\{ankorstoreBadgeState\.syncRequired && !pendingAnkorstoreEnqueue\}/);
    expect(SRC).toMatch(/syncRequired=\{efashionBadgeState\.syncRequired && !pendingEfashionEnqueue\}/);
    expect(SRC).toMatch(/syncRequired=\{faireBadgeState\.syncRequired && !pendingFaireEnqueue\}/);
    // Régression : ne plus recalculer syncRequired à partir des props RSC brutes
    expect(SRC).not.toMatch(/product\.pfsSyncRequired && !isPfsPublishing && !pfsBadgeState\.justPublishedOk/);
    expect(SRC).not.toMatch(/product\.ankorsSyncRequired && !isAnkorstorePublishing && !ankorstoreBadgeState\.justPublishedOk/);
    expect(SRC).not.toMatch(/product\.efashionSyncRequired && !isEfashionPublishing && !efashionBadgeState\.justPublishedOk/);
  });

  it("computeMarketplaceBadgeState reçoit bien product.xxxSyncRequired en 4e arg pour activer la fenêtre de grâce", () => {
    // Sans ce 4e arg, xxxBadgeState.syncRequired vaut toujours false (defaut).
    // Les args suivants (undefined = now par défaut, sticky client) sont optionnels.
    expect(SRC).toMatch(/computeMarketplaceBadgeState\(\s*product\.pfsProductId,\s*pfsOp,\s*"pfs",\s*product\.pfsSyncRequired,/);
    expect(SRC).toMatch(/computeMarketplaceBadgeState\(\s*product\.ankorsProductId,\s*ankorstoreOp,\s*"ankorstore",\s*product\.ankorsSyncRequired,/);
    expect(SRC).toMatch(/computeMarketplaceBadgeState\(\s*efashionLinked \? "linked" : null,\s*efashionOp,\s*"efashion",\s*product\.efashionSyncRequired,/);
    expect(SRC).toMatch(/computeMarketplaceBadgeState\(\s*product\.faireProductId,\s*faireOp,\s*"faire",\s*product\.faireSyncRequired,/);
  });

  it("computeMarketplaceBadgeState reçoit aussi le sticky client-side pour éliminer le flash orange post-sync", () => {
    // Sticky green client-side : mémoire tenue par MarketplaceRefreshContext,
    // rend le masquage du orange robuste face aux races (poll perdu, décalage
    // d'horloge serveur, RSC en retard). Passé en 6ᵉ arg de
    // computeMarketplaceBadgeState (le 5ᵉ = `now`, laissé à undefined).
    expect(SRC).toMatch(/getRecentClientSuccessAt\(product\.id,\s*"pfs"\)/);
    expect(SRC).toMatch(/getRecentClientSuccessAt\(product\.id,\s*"ankorstore"\)/);
    expect(SRC).toMatch(/getRecentClientSuccessAt\(product\.id,\s*"efashion"\)/);
    expect(SRC).toMatch(/getRecentClientSuccessAt\(product\.id,\s*"faire"\)/);
  });
});
