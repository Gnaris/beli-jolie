import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CategoriesList from "@/components/admin/categories/CategoriesList";
import type { CategoryForFilters } from "@/lib/category-filters";

type Cat = CategoryForFilters & { productCount: number };

const cats: Cat[] = [
  { id: "a", name: "Bagues", translations: { fr: "Bagues", en: "Rings" }, pfsCategoryId: "pfs-a", pfsGender: "W", pfsFamilyName: "B", pfsCategoryName: "Bagues", efashionCategorieId: 1, faireTaxonomyId: "x", productCount: 56 },
  { id: "b", name: "Colliers", translations: {}, pfsCategoryId: null, pfsGender: null, pfsFamilyName: null, pfsCategoryName: null, efashionCategorieId: null, faireTaxonomyId: null, productCount: 89 },
];

describe("CategoriesList", () => {
  it("rend toutes les catégories et marque la sélection active", () => {
    render(
      <CategoriesList
        categories={cats}
        selectedId="b"
        onSelect={() => {}}
        hasEfashionConfig
        hasFaireConfig
        hasPfsConfig
      />,
    );
    expect(screen.getByText("Bagues")).toBeInTheDocument();
    expect(screen.getByText("Colliers")).toBeInTheDocument();
    const active = screen.getByText("Colliers").closest('[data-cat-id]');
    expect(active?.getAttribute("data-active")).toBe("true");
  });
  it("click sur une catégorie appelle onSelect", () => {
    const onSelect = vi.fn();
    render(<CategoriesList categories={cats} selectedId={null} onSelect={onSelect} hasEfashionConfig hasFaireConfig hasPfsConfig />);
    fireEvent.click(screen.getByText("Bagues"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });
  it("la barre de recherche filtre la liste", () => {
    render(<CategoriesList categories={cats} selectedId={null} onSelect={() => {}} hasEfashionConfig hasFaireConfig hasPfsConfig />);
    const input = screen.getByPlaceholderText(/Rechercher/i);
    fireEvent.change(input, { target: { value: "coll" } });
    expect(screen.queryByText("Bagues")).not.toBeInTheDocument();
    expect(screen.getByText("Colliers")).toBeInTheDocument();
  });
  it("le filtre 'Sans traduction' montre uniquement les non traduites", () => {
    render(<CategoriesList categories={cats} selectedId={null} onSelect={() => {}} hasEfashionConfig hasFaireConfig hasPfsConfig />);
    fireEvent.click(screen.getByRole("button", { name: /Sans traduction/i }));
    expect(screen.queryByText("Bagues")).not.toBeInTheDocument();
    expect(screen.getByText("Colliers")).toBeInTheDocument();
  });
  it("masque le filtre eFashion si hasEfashionConfig=false", () => {
    render(<CategoriesList categories={cats} selectedId={null} onSelect={() => {}} hasEfashionConfig={false} hasFaireConfig hasPfsConfig />);
    expect(screen.queryByRole("button", { name: /Sans eFashion/i })).not.toBeInTheDocument();
  });
  it("affiche le total en bas", () => {
    render(<CategoriesList categories={cats} selectedId={null} onSelect={() => {}} hasEfashionConfig hasFaireConfig hasPfsConfig />);
    expect(screen.getByText(/2 catégories.*145 produits/)).toBeInTheDocument();
  });
});
