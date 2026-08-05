/**
 * Tests pour `pickReplyToAddress` (lib/mail-notify-worker.ts).
 *
 * Contexte métier : quand un client écrit sur `contact@boutique.com`, le
 * worker transfère le mail vers la boîte perso de l'admin. Sans header
 * `Reply-To:`, Gmail préremplit la réponse avec le `From:` du forward =
 * l'adresse pro de l'admin — le mail lui revient au lieu de partir au
 * client. Cette fonction extrait l'adresse email brute du client original
 * (priorité : Reply-To > From > Sender) pour la poser en Reply-To du
 * forward, ce qui redirige les réponses Gmail vers le vrai client.
 */
import { describe, it, expect } from "vitest";
import { pickReplyToAddress } from "@/lib/mail-notify-worker";

describe("pickReplyToAddress", () => {
  it("retourne l'adresse From quand pas de Reply-To original", () => {
    expect(
      pickReplyToAddress({
        from: [{ name: "Alice Client", address: "alice@client.com" }],
      })
    ).toBe("alice@client.com");
  });

  it("préfère Reply-To original quand présent (ex. mailing-list)", () => {
    expect(
      pickReplyToAddress({
        replyTo: [{ name: null, address: "list-reply@newsletter.com" }],
        from: [{ address: "no-reply@newsletter.com" }],
      })
    ).toBe("list-reply@newsletter.com");
  });

  it("tombe sur Sender si From et Reply-To vides", () => {
    expect(
      pickReplyToAddress({
        replyTo: [],
        from: [],
        sender: [{ address: "envoi@systeme.com" }],
      })
    ).toBe("envoi@systeme.com");
  });

  it("ignore les entrées sans @ (valeurs malformées)", () => {
    expect(
      pickReplyToAddress({
        from: [{ address: "pas-une-adresse" }, { address: "vrai@client.com" }],
      })
    ).toBe("vrai@client.com");
  });

  it("trim les espaces autour de l'adresse", () => {
    expect(
      pickReplyToAddress({
        from: [{ address: "  bob@client.com  " }],
      })
    ).toBe("bob@client.com");
  });

  it("retourne null si envelope vide/manquante", () => {
    expect(pickReplyToAddress(null)).toBeNull();
    expect(pickReplyToAddress(undefined)).toBeNull();
    expect(pickReplyToAddress({})).toBeNull();
    expect(pickReplyToAddress({ from: [], replyTo: [], sender: [] })).toBeNull();
  });

  it("ignore les entrées address vide/null", () => {
    expect(
      pickReplyToAddress({
        replyTo: [{ address: "" }, { address: null }],
        from: [{ address: "fallback@client.com" }],
      })
    ).toBe("fallback@client.com");
  });
});
