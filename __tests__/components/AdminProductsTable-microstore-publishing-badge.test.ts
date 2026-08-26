import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Depuis 2026-08-26 : le badge MC (Microstore) doit passer en bleu « En cours »
// dès qu'un push (publication / modification / synchro / rafraîchissement /
// rafraîchissement étalé) est en file ou en train de tourner pour ce produit,
// exactement comme PFS/Ankor/eFa/Faire/OC. Le calcul repose sur
// `microstoreBadgeState.loading` (venu de la file marketplace-refresh) +
// verrou local `pendingMicrostoreEnqueue` pour couvrir le bref délai entre
// le clic et l'apparition du job côté serveur.
const SRC = readFileSync(
  resolve(__dirname, "../../components/admin/products/AdminProductsTable.tsx"),
  "utf8",
);

describe("AdminProductsTable — badge MC (Microstore) en état « En cours » bleu", () => {
  it("MicrostoreBadge accepte une prop `publishing`", () => {
    // La signature du composant expose bien la prop, avec valeur par défaut
    // à false pour rester compatible avec les usages qui ne fournissent pas
    // encore le flag.
    expect(SRC).toMatch(/function MicrostoreBadge\({[\s\S]*?publishing = false/);
  });

  it("MicrostoreBadge rend le badge bleu (indigo #EEF2FF/#4F46E5) avec spinner quand `publishing` vaut true", () => {
    // Même palette que les 5 autres marketplaces pour que la ligne de badges
    // reste homogène pendant les push groupés.
    expect(SRC).toMatch(
      /if \(publishing\) \{[\s\S]*?bg-\[#EEF2FF\] text-\[#4F46E5\] border border-\[#C7D2FE\][\s\S]*?title="Envoi Microstore en cours…"/,
    );
    // Le spinner tourne (animate-spin) — indispensable pour que la cliente
    // comprenne qu'un traitement est en cours et qu'elle ne peut pas re-cliquer.
    expect(SRC).toMatch(
      /if \(publishing\) \{[\s\S]*?<svg\s+className="w-3 h-3 animate-spin/,
    );
  });

  it("le badge MC desktop reçoit `publishing={isMicrostorePublishing}`", () => {
    // Sans ce câblage, le composant garderait la couleur précédente (vert /
    // orange / rouge) pendant tout le push — la cliente n'aurait aucun retour
    // visuel qu'un traitement Microstore tourne.
    expect(SRC).toMatch(/<MicrostoreBadge[\s\S]*?publishing=\{isMicrostorePublishing\}/);
  });

  it("le badge MC mobile (MpDot) reçoit `busy={isMicrostorePublishing}` (aligné PFS/Ankor/eFa/Faire/OC)", () => {
    // La version mobile passe par MpDot, qui affiche déjà un spinner quand
    // busy=true — il suffisait de brancher la vraie valeur (avant : verrou
    // local `microstoreBusy` remis à false immédiatement après enqueue).
    expect(SRC).toMatch(
      /label="MC"[\s\S]*?busy=\{isMicrostorePublishing\}/,
    );
  });

  it("`isMicrostorePublishing` combine `microstoreBadgeState.loading` et `pendingMicrostoreEnqueue`", () => {
    // Le badge doit rester bleu (a) tant que la file marketplace n'a pas
    // encore remonté l'op en queued/in_progress ET (b) pendant toute la
    // durée où l'op est active côté serveur — d'où le OU logique.
    expect(SRC).toMatch(
      /const isMicrostorePublishing = microstoreBadgeState\.loading \|\| pendingMicrostoreEnqueue/,
    );
  });

  it("verrou local `pendingMicrostoreEnqueue` libéré quand la file passe en loading", () => {
    // Sans ce useEffect, le badge resterait bleu à jamais si le job disparaît
    // instantanément (erreur d'enqueue) — c'est le même schéma que pour les
    // 5 autres marketplaces.
    expect(SRC).toMatch(
      /if \(pendingMicrostoreEnqueue && microstoreBadgeState\.loading\) \{[\s\S]*?setPendingMicrostoreEnqueue\(false\)/,
    );
  });
});
