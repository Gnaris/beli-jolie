import { describe, it, expect } from "vitest";
import { deduceEvent, deduceCause } from "@/lib/log-events";

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

describe("deduceCause", () => {
  it("reconnaît ECONNREFUSED", () => {
    expect(deduceCause(new Error("connect ECONNREFUSED 127.0.0.1:3306"))).toBe(
      "Le service distant refuse la connexion"
    );
  });

  it("reconnaît ETIMEDOUT", () => {
    expect(deduceCause(new Error("ETIMEDOUT"))).toBe("Délai d'attente dépassé");
  });

  it("reconnaît 'Timeout' générique", () => {
    expect(deduceCause(new Error("Connection timeout after 30000ms"))).toBe(
      "Délai d'attente dépassé"
    );
  });

  it("reconnaît ENOTFOUND", () => {
    expect(deduceCause(new Error("getaddrinfo ENOTFOUND api.foo.com"))).toBe(
      "Adresse introuvable (DNS)"
    );
  });

  it("reconnaît ENOENT", () => {
    expect(deduceCause(new Error("ENOENT: no such file or directory"))).toBe(
      "Fichier ou dossier introuvable"
    );
  });

  it("reconnaît EACCES", () => {
    expect(deduceCause(new Error("EACCES: permission denied"))).toBe(
      "Permission refusée"
    );
  });

  it("reconnaît ENOSPC", () => {
    expect(deduceCause(new Error("ENOSPC: no space left on device"))).toBe(
      "Plus d'espace disque"
    );
  });

  it("reconnaît 'Unique constraint failed'", () => {
    expect(
      deduceCause(new Error("Unique constraint failed on the fields: (`email`)"))
    ).toBe("Cette valeur existe déjà en base");
  });

  it("reconnaît 'Foreign key constraint failed'", () => {
    expect(deduceCause(new Error("Foreign key constraint failed on the field: `userId`"))).toBe(
      "Lien vers une donnée qui n'existe pas"
    );
  });

  it("reconnaît 'Record to update not found'", () => {
    expect(deduceCause(new Error("Record to update not found."))).toBe(
      "L'enregistrement à modifier n'existe plus"
    );
  });

  it("reconnaît JsonWebTokenError par nom", () => {
    const err = new Error("invalid signature");
    err.name = "JsonWebTokenError";
    expect(deduceCause(err)).toBe("Jeton de session invalide");
  });

  it("reconnaît TokenExpiredError par nom", () => {
    const err = new Error("jwt expired");
    err.name = "TokenExpiredError";
    expect(deduceCause(err)).toBe("Jeton de session expiré");
  });

  it("reconnaît 429 dans le message", () => {
    expect(deduceCause(new Error("Request failed with status 429"))).toBe(
      "Trop de requêtes, le service distant nous limite"
    );
  });

  it("reconnaît 401 dans le message", () => {
    expect(deduceCause(new Error("HTTP 401 Unauthorized"))).toBe(
      "Non autorisé par le service distant"
    );
  });

  it("reconnaît 503 dans le message", () => {
    expect(deduceCause(new Error("Status 503 Service Unavailable"))).toBe(
      "Le service distant est en panne ou surchargé"
    );
  });

  it("retourne null quand aucun pattern ne matche", () => {
    expect(deduceCause(new Error("complètement inattendu"))).toBeNull();
  });

  it("retourne null pour une string ou autre", () => {
    expect(deduceCause("foo")).toBeNull();
    expect(deduceCause(null)).toBeNull();
    expect(deduceCause(undefined)).toBeNull();
  });
});
