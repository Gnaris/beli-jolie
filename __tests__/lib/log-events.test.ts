import { describe, it, expect } from "vitest";
import {
  deduceEvent,
  deduceCause,
  extractSource,
  formatErrorBlock,
  formatInfoLine,
} from "@/lib/log-events";

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

describe("extractSource", () => {
  it("retourne la 1ère frame app dans /lib/", () => {
    const stack = `Error: boom
    at Object.<anonymous> (/var/www/beliandjolie/node_modules/foo/index.js:42:10)
    at fetchPfsAuth (/var/www/beliandjolie/lib/pfs-publish.ts:142:5)
    at publishProductOnPfs (/var/www/beliandjolie/lib/pfs-publish.ts:88:3)`;
    expect(extractSource(stack)).toBe("lib/pfs-publish.ts:142");
  });

  it("retourne la 1ère frame app dans /app/", () => {
    const stack = `Error: x
    at handler (/var/www/beliandjolie/app/api/foo/route.ts:23:7)`;
    expect(extractSource(stack)).toBe("app/api/foo/route.ts:23");
  });

  it("ignore les frames node_modules", () => {
    const stack = `Error: x
    at A (/var/www/beliandjolie/node_modules/prisma/runtime.js:12:1)
    at B (/var/www/beliandjolie/node_modules/next/server.js:55:2)
    at C (/var/www/beliandjolie/lib/foo.ts:9:1)`;
    expect(extractSource(stack)).toBe("lib/foo.ts:9");
  });

  it("ignore .next/", () => {
    const stack = `Error: x
    at A (/var/www/beliandjolie/.next/server/chunks/123.js:1:1)
    at B (/var/www/beliandjolie/lib/bar.ts:5:1)`;
    expect(extractSource(stack)).toBe("lib/bar.ts:5");
  });

  it("retourne null si aucune frame app", () => {
    const stack = `Error: x
    at A (/var/www/beliandjolie/node_modules/foo/index.js:1:1)`;
    expect(extractSource(stack)).toBeNull();
  });

  it("retourne null si stack vide ou undefined", () => {
    expect(extractSource(undefined)).toBeNull();
    expect(extractSource("")).toBeNull();
  });

  it("supporte les frames sans parenthèses (V8 minimal)", () => {
    const stack = `Error: x
    at /var/www/beliandjolie/lib/baz.ts:7:3`;
    expect(extractSource(stack)).toBe("lib/baz.ts:7");
  });

  it("supporte les chemins Windows (\\)", () => {
    // En template literal, \\ représente UN backslash dans la string.
    const stack = `Error: x
    at fn (C:\\Users\\chenb\\Desktop\\beli-jolie\\lib\\foo.ts:10:5)`;
    expect(extractSource(stack)).toBe("lib/foo.ts:10");
  });
});

describe("formatErrorBlock", () => {
  const FIXED_DATE = new Date("2026-05-09T14:32:18.000Z"); // = 16:32:18 Europe/Paris (CEST)

  it("formate une erreur simple sans error object", () => {
    const out = formatErrorBlock({
      level: "error",
      message: "[Storage] cannot write",
      meta: {},
      now: FIXED_DATE,
    });
    expect(out).toContain("❌ ERREUR");
    expect(out).toContain("09/05/2026");
    expect(out).toContain("Événement     : Stockage de fichier");
    expect(out).toContain("Détail        : cannot write");
    expect(out).not.toContain("Type erreur");
    expect(out).not.toContain("Message brut");
    expect(out).not.toContain("Stack");
    // Encadré
    expect(out.startsWith("─")).toBe(true);
    expect(out.trim().endsWith("─")).toBe(true);
  });

  it("inclut type, message brut et stack quand error est un Error", () => {
    const err = new Error("Connection timeout after 30000ms");
    err.name = "TimeoutError";
    err.stack = `TimeoutError: Connection timeout after 30000ms
    at fetchPfsAuth (/app/lib/pfs-publish.ts:142:5)
    at publishProductOnPfs (/app/lib/pfs-publish.ts:88:3)`;

    const out = formatErrorBlock({
      level: "error",
      message: "[PFS] publication failed",
      meta: { error: err, productRef: "ROBE-12345" },
      now: FIXED_DATE,
    });
    expect(out).toContain("Événement     : Synchronisation PFS");
    expect(out).toContain("Détail        : publication failed");
    expect(out).toContain("Type erreur   : TimeoutError");
    expect(out).toContain("Message brut  : Connection timeout after 30000ms");
    expect(out).toContain("Cause probable: Délai d'attente dépassé");
    expect(out).toContain("Source        : lib/pfs-publish.ts:142");
    expect(out).toContain("Stack         :");
    expect(out).toContain("at fetchPfsAuth");
    expect(out).toContain("Product ref   : ROBE-12345"); // champ custom (humanisé)
  });

  it("humanise les clés camelCase à plusieurs mots", () => {
    const out = formatErrorBlock({
      level: "error",
      message: "x",
      meta: { pfsProductId: "abc-123" },
      now: FIXED_DATE,
    });
    expect(out).toContain("Pfs product id: abc-123"); // 14 chars label
  });

  it("force l'event quand meta.event est fourni", () => {
    const out = formatErrorBlock({
      level: "error",
      message: "[Storage] x",
      meta: { event: "Validation commande" },
      now: FIXED_DATE,
    });
    expect(out).toContain("Événement     : Validation commande");
  });

  it("utilise ⚠️ AVERTISSEMENT pour warn", () => {
    const out = formatErrorBlock({
      level: "warn",
      message: "low disk",
      meta: {},
      now: FIXED_DATE,
    });
    expect(out).toContain("⚠️");
    expect(out).toContain("AVERTISSEMENT");
  });

  it("tronque la stack à 5 lignes et indique le reste", () => {
    const err = new Error("x");
    err.stack = ["Error: x", ...Array.from({ length: 10 }, (_, i) => `    at fn${i} (/app/lib/x.ts:${i}:1)`)].join("\n");
    const out = formatErrorBlock({
      level: "error",
      message: "x",
      meta: { error: err },
      now: FIXED_DATE,
    });
    expect(out).toContain("at fn0");
    expect(out).toContain("at fn4");
    expect(out).not.toContain("at fn5");
    expect(out).toContain("... (5 autres lignes)");
  });

  it("affiche la date au format JJ/MM/AAAA HH:MM:SS Europe/Paris", () => {
    const out = formatErrorBlock({
      level: "error",
      message: "x",
      meta: {},
      now: new Date("2026-12-31T23:30:00.000Z"), // = 00:30:00 le 01/01/2027 Paris
    });
    expect(out).toContain("01/01/2027 00:30:00");
  });
});

describe("formatInfoLine", () => {
  const FIXED_DATE = new Date("2026-05-09T14:32:18.000Z"); // 16:32:18 Paris

  it("formate sur une ligne compacte avec date courte", () => {
    const out = formatInfoLine({ message: "Server started", meta: { port: 3000 }, now: FIXED_DATE });
    expect(out).toBe("[09/05 16:32:18] ℹ️  Server started {\"port\":3000}");
  });

  it("omet la meta vide", () => {
    const out = formatInfoLine({ message: "ping", meta: {}, now: FIXED_DATE });
    expect(out).toBe("[09/05 16:32:18] ℹ️  ping");
  });
});
