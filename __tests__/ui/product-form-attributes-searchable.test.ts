import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../components/admin/products/ProductForm.tsx"),
  "utf8",
);

function selectBlockByPlaceholder(placeholder: string): string {
  const idx = SRC.indexOf(`placeholder="${placeholder}"`);
  if (idx === -1) throw new Error(`Placeholder introuvable: ${placeholder}`);
  const start = SRC.lastIndexOf("<CustomSelect", idx);
  const end = SRC.indexOf("/>", idx);
  if (start === -1 || end === -1) {
    throw new Error(`Bloc CustomSelect introuvable pour: ${placeholder}`);
  }
  return SRC.slice(start, end + 2);
}

describe("ProductForm — mini barre de recherche dans les sélecteurs d'attributs", () => {
  it("la catégorie est filtrable au clavier", () => {
    expect(selectBlockByPlaceholder("— Sélectionner —")).toContain("searchable");
  });

  it("le pays de fabrication est filtrable au clavier", () => {
    expect(selectBlockByPlaceholder("— Aucun —")).toContain("searchable");
  });

  it("la saison est filtrable au clavier", () => {
    expect(selectBlockByPlaceholder("— Aucune —")).toContain("searchable");
  });

  it("le matériau de composition est filtrable au clavier", () => {
    expect(selectBlockByPlaceholder("— Choisir un matériau —")).toContain(
      "searchable",
    );
  });
});
