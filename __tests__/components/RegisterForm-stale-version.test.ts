import { describe, it, expect } from "vitest";

/**
 * RegisterForm : détection du message "version périmée" quand l'API
 * répond 500. Ça arrive quand la cliente laisse la page d'inscription
 * ouverte, qu'un déploiement est fait pendant sa saisie et que le
 * navigateur envoie sa demande avec des références de chunks Turbopack
 * qui n'existent plus sur le serveur (ChunkLoadError SSR côté prod).
 *
 * On teste juste la règle de décision (status HTTP → variante d'erreur)
 * pour éviter de monter tout le composant. La règle vraie vit dans
 * components/auth/RegisterForm.tsx::handleSubmit().
 */

type ErrorOutcome =
  | { kind: "stale"; message: string }
  | { kind: "server"; message: string };

function pickErrorOutcome(
  status: number,
  body: { error?: string },
  staleMessage: string,
  fallback: string,
): ErrorOutcome {
  if (status === 500) {
    return { kind: "stale", message: staleMessage };
  }
  return { kind: "server", message: body.error ?? fallback };
}

describe("RegisterForm — mapping status HTTP → variante d'erreur", () => {
  const stale = "Une nouvelle version du site a été publiée…";
  const fallback = "Le fichier Kbis est obligatoire.";

  it("500 → toujours la variante stale, même si l'API renvoie un message", () => {
    const out = pickErrorOutcome(500, { error: "Erreur générique" }, stale, fallback);
    expect(out).toEqual({ kind: "stale", message: stale });
  });

  it("500 sans body → variante stale", () => {
    const out = pickErrorOutcome(500, {}, stale, fallback);
    expect(out.kind).toBe("stale");
  });

  it("400 → message serveur affiché tel quel (validation Zod)", () => {
    const out = pickErrorOutcome(400, { error: "L'email est invalide." }, stale, fallback);
    expect(out).toEqual({ kind: "server", message: "L'email est invalide." });
  });

  it("409 → message serveur affiché tel quel (email déjà pris)", () => {
    const out = pickErrorOutcome(409, { error: "Un compte existe déjà avec cet email." }, stale, fallback);
    expect(out).toEqual({ kind: "server", message: "Un compte existe déjà avec cet email." });
  });

  it("429 → message serveur affiché tel quel (anti-spam)", () => {
    const out = pickErrorOutcome(429, { error: "Merci d'attendre 3h avant de réessayer." }, stale, fallback);
    expect(out.kind).toBe("server");
  });

  it("400 sans body → fallback traduit", () => {
    const out = pickErrorOutcome(400, {}, stale, fallback);
    expect(out).toEqual({ kind: "server", message: fallback });
  });
});
