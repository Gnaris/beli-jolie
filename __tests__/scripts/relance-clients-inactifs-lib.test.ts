/**
 * Tests pour scripts/relance-clients-inactifs-lib.ts
 * — buildEmailForClient : déterministe + variantes distinctes
 * — appendAdminNote : préserve l'existant + tronque à 2000 char
 */
import { describe, it, expect } from "vitest";
import {
  INTROS,
  QUESTION_ORDERS,
  CLOSERS,
  SUBJECTS,
  buildEmailForClient,
  appendAdminNote,
} from "@/scripts/relance-clients-inactifs-lib";

describe("buildEmailForClient", () => {
  it("place la société dans la salutation", () => {
    const out = buildEmailForClient({
      company: "Bijouterie Martin",
      introIdx: 0,
      orderIdx: 0,
      closerIdx: 0,
      subjectIdx: 0,
    });
    expect(out.text.startsWith("Bonjour Bijouterie Martin,")).toBe(true);
    expect(out.html).toContain("Bonjour Bijouterie Martin,");
  });

  it("produit un mail déterministe pour les mêmes indices", () => {
    const a = buildEmailForClient({ company: "X", introIdx: 2, orderIdx: 1, closerIdx: 3, subjectIdx: 1 });
    const b = buildEmailForClient({ company: "X", introIdx: 2, orderIdx: 1, closerIdx: 3, subjectIdx: 1 });
    expect(a.text).toBe(b.text);
    expect(a.subject).toBe(b.subject);
    expect(a.html).toBe(b.html);
  });

  it("génère au moins 60 corps distincts sur les 72 combinaisons", () => {
    const seen = new Set<string>();
    for (let i = 0; i < INTROS.length; i++) {
      for (let j = 0; j < QUESTION_ORDERS.length; j++) {
        for (let k = 0; k < CLOSERS.length; k++) {
          for (let s = 0; s < SUBJECTS.length; s++) {
            const out = buildEmailForClient({
              company: "Boutique Test",
              introIdx: i,
              orderIdx: j,
              closerIdx: k,
              subjectIdx: s,
            });
            seen.add(out.text + "|" + out.subject);
          }
        }
      }
    }
    // 6 × 3 × 4 × 4 = 288 combos, tous les corps doivent être uniques.
    expect(seen.size).toBe(INTROS.length * QUESTION_ORDERS.length * CLOSERS.length * SUBJECTS.length);
    expect(seen.size).toBeGreaterThanOrEqual(60);
  });

  it("HTML échappe correctement une société avec caractères spéciaux", () => {
    const out = buildEmailForClient({
      company: "Bijoux <O'Brien> & Co",
      introIdx: 0,
      orderIdx: 0,
      closerIdx: 0,
      subjectIdx: 0,
    });
    expect(out.html).toContain("Bijoux &lt;O&#39;Brien&gt; &amp; Co");
    expect(out.html).not.toContain("<O'Brien>");
  });
});

describe("appendAdminNote", () => {
  const date = new Date("2026-09-21T10:00:00Z");

  it("crée une note simple quand l'existant est vide", () => {
    const out = appendAdminNote(null, date, "mail de suivi envoyé");
    expect(out).toBe("— 21/09/2026 · mail de suivi envoyé");
  });

  it("ajoute une ligne sans écraser l'existant", () => {
    const existing = "Client rencontré au salon Bijorhca 2026.";
    const out = appendAdminNote(existing, date, "mail de suivi envoyé");
    expect(out).toBe(
      "Client rencontré au salon Bijorhca 2026.\n— 21/09/2026 · mail de suivi envoyé",
    );
  });

  it("tronque le début si le total dépasse 2000 caractères", () => {
    const bigExisting = "a".repeat(1990);
    const out = appendAdminNote(bigExisting, date, "mail de suivi envoyé");
    expect(out.length).toBeLessThanOrEqual(2000);
    // La ligne fraîche est bien à la fin.
    expect(out.endsWith("— 21/09/2026 · mail de suivi envoyé")).toBe(true);
    // On a bien tronqué avec "..." en tête.
    expect(out.startsWith("...")).toBe(true);
  });

  it("préserve intégralement une note existante juste sous la limite", () => {
    const almostFull = "x".repeat(1900);
    const out = appendAdminNote(almostFull, date, "mail envoyé");
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain(almostFull);
    expect(out.endsWith("— 21/09/2026 · mail envoyé")).toBe(true);
  });
});
