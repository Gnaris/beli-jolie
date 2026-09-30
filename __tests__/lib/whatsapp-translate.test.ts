/**
 * Tests de la protection des variables lors de la traduction WhatsApp.
 *
 * On teste `protectVariables` + `restoreVariables` en isolation (fonctions
 * pures). L'appel PFS lui-même (`translateWhatsAppBodyToEnglish`) est
 * couvert plus haut par les tests d'intégration de `translate.ts` — ici on
 * concentre sur la logique de sentinelles qui est notre valeur ajoutée.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  protectVariables,
  restoreVariables,
  translateWhatsAppBodyToEnglish,
} from "@/lib/whatsapp-translate";

vi.mock("@/lib/translate", () => ({
  translateTextStrict: vi.fn(),
}));

import { translateTextStrict } from "@/lib/translate";

describe("protectVariables", () => {
  it("remplace chaque {token} par ⟦N⟧ et mémorise le nom", () => {
    const { masked, tokens } = protectVariables(
      "Bonjour {firstName}, c'est {adminFirstName} de {shopName}.",
    );
    expect(masked).toBe("Bonjour ⟦0⟧, c'est ⟦1⟧ de ⟦2⟧.");
    expect(tokens).toEqual(["firstName", "adminFirstName", "shopName"]);
  });

  it("dédoublonne l'index par occurrence (chaque {token} = 1 sentinelle)", () => {
    // Même token utilisé deux fois → deux entrées dans tokens
    const { masked, tokens } = protectVariables("Bonjour {firstName} et {firstName}");
    expect(masked).toBe("Bonjour ⟦0⟧ et ⟦1⟧");
    expect(tokens).toEqual(["firstName", "firstName"]);
  });

  it("laisse passer un texte sans variables", () => {
    const { masked, tokens } = protectVariables("Message tout simple.");
    expect(masked).toBe("Message tout simple.");
    expect(tokens).toEqual([]);
  });

  it("ignore les accolades vides ou malformées", () => {
    const { masked, tokens } = protectVariables("Test {} et {123abc} et {ok}");
    // {} → pas remplacé, {123abc} → commence par un chiffre donc rejeté
    expect(tokens).toEqual(["ok"]);
    expect(masked).toBe("Test {} et {123abc} et ⟦0⟧");
  });
});

describe("restoreVariables", () => {
  it("restaure chaque ⟦N⟧ en {token}", () => {
    const out = restoreVariables("Hello ⟦0⟧, this is ⟦1⟧ from ⟦2⟧.", [
      "firstName",
      "adminFirstName",
      "shopName",
    ]);
    expect(out).toBe("Hello {firstName}, this is {adminFirstName} from {shopName}.");
  });

  it("retourne null si une sentinelle est manquante", () => {
    // On perd la sentinelle ⟦1⟧
    const out = restoreVariables("Hello ⟦0⟧ from ⟦2⟧.", ["firstName", "adminFirstName", "shopName"]);
    expect(out).toBeNull();
  });

  it("retourne null si une sentinelle est dupliquée par le moteur", () => {
    // Le moteur a répété ⟦0⟧ deux fois — restauration ambiguë
    const out = restoreVariables("Hello ⟦0⟧ and ⟦0⟧", ["firstName", "adminFirstName"]);
    expect(out).toBeNull();
  });

  it("retourne null si l'index est hors bornes", () => {
    const out = restoreVariables("Hello ⟦5⟧", ["firstName"]);
    expect(out).toBeNull();
  });

  it("retourne null si des ⟦ résiduels traînent (guillemets orphelins)", () => {
    // Il reste un ⟦ sans nombre valide
    const out = restoreVariables("Hello ⟦0⟧ and ⟦x⟧", ["firstName"]);
    expect(out).toBeNull();
  });

  it("retourne le texte tel quel quand tokens est vide", () => {
    const out = restoreVariables("Message tout simple.", []);
    expect(out).toBe("Message tout simple.");
  });
});

describe("translateWhatsAppBodyToEnglish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appelle PFS avec un texte masqué, puis restaure les variables", async () => {
    vi.mocked(translateTextStrict).mockResolvedValue(
      "Hello ⟦0⟧, this is ⟦1⟧ from ⟦2⟧.",
    );
    const out = await translateWhatsAppBodyToEnglish(
      "Bonjour {firstName}, c'est {adminFirstName} de {shopName}.",
    );
    expect(out).toBe("Hello {firstName}, this is {adminFirstName} from {shopName}.");
    expect(translateTextStrict).toHaveBeenCalledWith(
      "Bonjour ⟦0⟧, c'est ⟦1⟧ de ⟦2⟧.",
      "fr",
      "en",
    );
  });

  it("retourne null si PFS échoue", async () => {
    vi.mocked(translateTextStrict).mockResolvedValue(null);
    const out = await translateWhatsAppBodyToEnglish("Bonjour {firstName}");
    expect(out).toBeNull();
  });

  it("retourne null si le moteur a cassé les sentinelles", async () => {
    // PFS a perdu la sentinelle 1
    vi.mocked(translateTextStrict).mockResolvedValue("Hello ⟦0⟧ from somewhere");
    const out = await translateWhatsAppBodyToEnglish("Bonjour {firstName} de {shopName}");
    expect(out).toBeNull();
  });

  it("retourne null pour un texte vide", async () => {
    const out = await translateWhatsAppBodyToEnglish("   ");
    expect(out).toBeNull();
    expect(translateTextStrict).not.toHaveBeenCalled();
  });

  it("gère un texte sans variables", async () => {
    vi.mocked(translateTextStrict).mockResolvedValue("Simple message.");
    const out = await translateWhatsAppBodyToEnglish("Message simple.");
    expect(out).toBe("Simple message.");
  });
});
