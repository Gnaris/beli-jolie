/**
 * Garde-fou anti-régression : l'audit PFS auto propage vers les marketplaces
 * en `RESYNC`, JAMAIS en `REFRESH`.
 *
 * Contexte 14/09/2026 : le scheduler d'audit auto enfilait des jobs
 * `mode="REFRESH"` sur eFashion + Faire, qui font un delete + recreate de la
 * fiche marketplace (nouvel ID). Résultat : 189 fiches eFashion et 189 fiches
 * Faire recréées en 24 h sur Issyma, URLs cassées côté acheteuses, favoris
 * perdus, stats reset. Voir feedback_no_refresh.md.
 *
 * Ce test lit le source de `enqueueMarketplacePropagation` et vérifie que
 * `mode: "REFRESH"` n'y apparaît pas. Toute réintroduction (accidentelle
 * ou par IA) déclenche un échec de test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../../lib/pfs-audit-runner.ts");

function extractFunctionBody(source: string, fnName: string): string {
  const start = source.indexOf(`function ${fnName}`);
  if (start < 0) throw new Error(`Fonction ${fnName} introuvable dans ${SOURCE_PATH}`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  throw new Error(`Fin de ${fnName} introuvable`);
}

describe("pfs-audit-runner propagation", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  const body = extractFunctionBody(source, "enqueueMarketplacePropagation");

  it("propage en RESYNC, jamais en REFRESH", () => {
    expect(body).not.toMatch(/mode:\s*["']REFRESH["']/);
    expect(body).not.toMatch(/mode:\s*["']refresh["']/);
    expect(body).toMatch(/mode:\s*["']RESYNC["']/);
    expect(body).toMatch(/mode:\s*["']resync["']/);
  });

  it("crée les jobs MarketplaceRefreshJob avec mode RESYNC", () => {
    const createBlock = body.match(
      /prisma\.marketplaceRefreshJob\.create\(\{[\s\S]*?\}\)/,
    );
    expect(createBlock).not.toBeNull();
    expect(createBlock![0]).toMatch(/mode:\s*["']RESYNC["']/);
    expect(createBlock![0]).not.toMatch(/mode:\s*["']REFRESH["']/);
  });
});
