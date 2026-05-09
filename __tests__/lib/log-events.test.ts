import { describe, it, expect } from "vitest";
import { deduceEvent } from "@/lib/log-events";

describe("deduceEvent", () => {
  it("retourne le libellé FR pour un préfixe connu", () => {
    expect(deduceEvent("[PFS Images] upload failed")).toEqual({
      event: "Image PFS",
      cleanMessage: "upload failed",
    });
  });

  it("retourne 'Synchronisation PFS' pour [PFS]", () => {
    expect(deduceEvent("[PFS] auth error")).toEqual({
      event: "Synchronisation PFS",
      cleanMessage: "auth error",
    });
  });

  it("retourne 'Stockage de fichier' pour [Storage]", () => {
    expect(deduceEvent("[Storage] cannot write")).toEqual({
      event: "Stockage de fichier",
      cleanMessage: "cannot write",
    });
  });

  it("retourne 'Erreur non catégorisée' quand aucun préfixe", () => {
    expect(deduceEvent("plain message")).toEqual({
      event: "Erreur non catégorisée",
      cleanMessage: "plain message",
    });
  });

  it("trim les espaces autour du message nettoyé", () => {
    expect(deduceEvent("[Email]   send failed  ")).toEqual({
      event: "Envoi d'email",
      cleanMessage: "send failed",
    });
  });
});
