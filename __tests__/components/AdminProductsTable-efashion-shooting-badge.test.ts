import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Feature : quand un produit est dans le lot de shooting eFashion (contexte
// EfashionShootingBatchContext, mode PUBLISH ou REFRESH), le badge « EF » de
// la colonne Marketplaces ne doit PAS rester rouge (« Publier / Lier »).
// Il passe dans un état intermédiaire ambre (En attente de shooting) et
// cliquer dessus ouvre le tiroir « Shooting » du widget flottant.

const SRC = readFileSync(
  resolve(__dirname, "../../components/admin/products/AdminProductsTable.tsx"),
  "utf8",
);

describe("AdminProductsTable — badge eFashion en attente de shooting", () => {
  it("EfashionBadge expose une prop shootingPending (PUBLISH | REFRESH | null)", () => {
    expect(SRC).toMatch(/shootingPending\?:\s*"PUBLISH"\s*\|\s*"REFRESH"\s*\|\s*null/);
    expect(SRC).toMatch(/onShootingClick\?:\s*\(\)\s*=>\s*void/);
  });

  it("la branche shootingPending est rendue AVANT le retour rouge (non-lié)", () => {
    // Priorité visuelle : disabled > publishing > shootingPending > syncRequired > linked > default(rouge)
    const idxShooting = SRC.indexOf("if (shootingPending)");
    const idxLinkedSync = SRC.indexOf("if (linked && syncRequired)");
    const idxLinked = SRC.indexOf("if (linked) {");
    expect(idxShooting).toBeGreaterThan(0);
    expect(idxLinkedSync).toBeGreaterThan(idxShooting);
    expect(idxLinked).toBeGreaterThan(idxLinkedSync);
  });

  it("la branche shootingPending utilise la palette ambre (pas rouge)", () => {
    // #FEF3C7 / #FDE68A / #92400E = amber-100/200/800 côté Tailwind
    expect(SRC).toMatch(
      /if \(shootingPending\)[\s\S]{0,800}bg-\[#FEF3C7\][\s\S]{0,300}text-\[#92400E\]/,
    );
  });

  it("ProductRow lit les items du batch shooting depuis useEfashionShootingBatch", () => {
    expect(SRC).toMatch(
      /items:\s*efashionShootingItems[\s\S]{0,120}=\s*useEfashionShootingBatch\(\)/,
    );
    expect(SRC).toMatch(
      /efashionShootingItems\.find\(\(i\)\s*=>\s*i\.productId\s*===\s*product\.id\)/,
    );
  });

  it("le badge EF reçoit shootingPending + un onShootingClick qui ouvre le tiroir shooting", () => {
    expect(SRC).toMatch(
      /<EfashionBadge[\s\S]{0,1000}shootingPending=\{efashionShootingPending\}/,
    );
    expect(SRC).toMatch(
      /<EfashionBadge[\s\S]{0,1200}onShootingClick=\{\(\)\s*=>\s*openRailWidget\("shooting"\)\}/,
    );
  });

  it("le MpDot mobile eFashion reçoit aussi shootingPending", () => {
    expect(SRC).toMatch(
      /<MpDot[\s\S]{0,300}label="EF"[\s\S]{0,300}shootingPending=\{!!efashionShootingPending\}/,
    );
  });
});
