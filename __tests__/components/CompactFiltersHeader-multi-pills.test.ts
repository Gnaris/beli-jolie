import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 2026-09-29 — Les 5 filtres Catalogue en multi-sélection produisent une pill
// par valeur cochée (au lieu d'une pill par filtre). Retirer une pill enlève
// UNE valeur, pas tout le filtre.

const HEADER = readFileSync(
  resolve(__dirname, "../../components/admin/products/CompactFiltersHeader.tsx"),
  "utf8",
);

describe("CompactFiltersHeader — pills multi-sélection", () => {
  it("expose un helper `multiPills` pour fabriquer une pill par valeur", () => {
    expect(HEADER).toContain("multiPills");
  });

  it("appelle multiPills pour les 5 clés multi (cat/subCat/tag/composition/hsCodeId)", () => {
    expect(HEADER).toContain('multiPills(p, "cat"');
    expect(HEADER).toContain('multiPills(p, "subCat"');
    expect(HEADER).toContain('multiPills(p, "tag"');
    expect(HEADER).toContain('multiPills(p, "composition"');
    expect(HEADER).toContain('multiPills(p, "hsCodeId"');
  });

  it("retirer une pill ne supprime que la valeur ciblée, pas la clé entière", () => {
    expect(HEADER).toContain("removeOneFromMulti");
    expect(HEADER).toContain('.filter((v) => v.length > 0 && v !== value)');
  });

  it("retirer une catégorie purge aussi la clé subCat (sinon sous-cats orphelines)", () => {
    expect(HEADER).toContain('if (key === "cat") params.delete("subCat")');
  });

  it("labellise les sous-catégories avec leur catégorie mère (`Cat › Sous-cat`)", () => {
    expect(HEADER).toContain("subCatLabels");
    expect(HEADER).toContain("`${c.name} › ${s.name}`");
  });

  it("supporte un handler onRemove custom sur chaque pill", () => {
    expect(HEADER).toContain("pill.onRemove");
    expect(HEADER).toContain("onRemove?:");
  });
});
