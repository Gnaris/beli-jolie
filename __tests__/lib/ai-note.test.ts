import { describe, it, expect } from "vitest";
import { buildAiNotePrefix, prependAiNote, containsAiCompletionMark } from "@/lib/ai-note";

describe("buildAiNotePrefix", () => {
  it("formate la date en DD/MM/YYYY", () => {
    const d = new Date("2026-06-30T10:00:00Z");
    expect(buildAiNotePrefix(d)).toBe("Complété par l'IA le 30/06/2026");
  });
});

describe("prependAiNote", () => {
  it("retourne le préfixe seul si la note précédente est vide", () => {
    const d = new Date("2026-06-30T10:00:00Z");
    expect(prependAiNote(null, d)).toBe("Complété par l'IA le 30/06/2026");
    expect(prependAiNote("", d)).toBe("Complété par l'IA le 30/06/2026");
  });

  it("ajoute le préfixe au-dessus de la note précédente avec séparateur", () => {
    const d = new Date("2026-06-30T10:00:00Z");
    expect(prependAiNote("Vu en salon Paris", d)).toBe(
      "Complété par l'IA le 30/06/2026\n---\nVu en salon Paris",
    );
  });

  it("ne duplique pas le préfixe si la note commence déjà par celui du jour", () => {
    const d = new Date("2026-06-30T10:00:00Z");
    const already = "Complété par l'IA le 30/06/2026\n---\nVieille note";
    expect(prependAiNote(already, d)).toBe(already);
  });
});

describe("containsAiCompletionMark", () => {
  it("détecte la mention quelle que soit la date", () => {
    expect(containsAiCompletionMark("Complété par l'IA le 12/01/2026")).toBe(true);
    expect(containsAiCompletionMark("blah\nComplété par l'IA le 30/06/2026")).toBe(true);
  });

  it("renvoie false si absent ou null", () => {
    expect(containsAiCompletionMark("Note manuelle")).toBe(false);
    expect(containsAiCompletionMark(null)).toBe(false);
    expect(containsAiCompletionMark("")).toBe(false);
  });
});
