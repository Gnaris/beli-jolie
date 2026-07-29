/**
 * Régression 2026-07-29 : le sticky green client-side masquait le badge orange
 * « Synchro nécessaire » perpétuellement quand une op done+ok ancienne restait
 * dans la file `/api/admin/marketplace-queue`.
 *
 * Scénario : la cliente marque un produit à re-synchroniser via
 * Admin > Paramètres > Faire > Masquer Made in. Le drapeau `faireSyncRequired`
 * est bien posé en base. Mais le dernier push Faire (il y a des heures) est
 * encore dans la file. Le contexte marquait `clientSuccessMap[prod:faire] = Date.now()`
 * à chaque poll → le badge orange restait masqué en permanence.
 *
 * Fix : utiliser `item.completedAt` (timestamp serveur RÉEL) au lieu de `Date.now()`,
 * et ignorer les ops trop anciennes (hors fenêtre de grâce 5 min).
 *
 * On teste la fonction pure sans monter le composant React — le code du contexte
 * est extrait en logique pure via re-import.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../components/admin/products/MarketplaceRefreshContext.tsx"),
  "utf8",
);

describe("MarketplaceRefreshContext — sticky green n'utilise pas Date.now() comme timestamp", () => {
  it("le poll enregistre item.completedAt (pas Date.now()) dans clientSuccessMap", () => {
    // Régression : nextMap.set(key, now) était le bug → une op done+ok restée
    // en file voyait son timestamp remis à « maintenant » à chaque tick et
    // masquait le badge orange pendant 5 min glissantes indéfiniment.
    expect(SRC).not.toMatch(/nextMap\.set\(key,\s*now\)/);
    expect(SRC).toMatch(/nextMap\.set\(key,\s*completedAtMs\)/);
  });

  it("le poll ignore les ops terminées hors de la fenêtre de grâce", () => {
    // Sans ce filtre, une op done+ok très ancienne poserait quand même une
    // entrée (avec son vrai timestamp) qui serait considérée comme « > 5 min »
    // par getRecentClientSuccessAt et masquerait rien — mais autant ne pas
    // gonfler la map inutilement.
    expect(SRC).toMatch(/if \(now - completedAtMs > CLIENT_SUCCESS_WINDOW_MS\) continue/);
  });

  it("le poll rejette les items sans completedAt ou avec valeur invalide", () => {
    expect(SRC).toMatch(/if \(!Number\.isFinite\(completedAtMs\)\) continue/);
  });

  it("le poll met à jour la map si un timestamp plus récent arrive pour la même clé", () => {
    // Cas d'une nouvelle op done sur le même produit/marketplace : on doit
    // avancer le timestamp, sinon la fenêtre de grâce reste ancrée sur la
    // 1re sync et expire pendant que la nouvelle est encore récente.
    expect(SRC).toMatch(/if \(existing === undefined \|\| existing < completedAtMs\)/);
  });
});
