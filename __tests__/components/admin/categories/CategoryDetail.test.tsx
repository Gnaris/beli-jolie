import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import CategoryDetail from "@/components/admin/categories/CategoryDetail";

const cat = {
  id: "c1",
  name: "Colliers",
  translations: { fr: "Colliers", en: "Necklaces" },
  productCount: 89,
  createdAt: new Date("2026-02-03T10:00:00Z"),
  subCategories: [
    { id: "s1", name: "Court", translations: { fr: "Court", en: "Short" } },
    { id: "s2", name: "Long", translations: { fr: "Long" } },
  ],
  pfsLabel: "Femme › Bijoux › Colliers",
  efashionLabel: "Femme › Bijoux",
  faireLabel: null,
};

const noop = () => {};

describe("CategoryDetail", () => {
  it("affiche le titre, les compteurs et la date", () => {
    render(
      <CategoryDetail
        category={cat}
        showBackButton={false}
        onBack={noop}
        onEdit={noop}
        onDelete={noop}
        onSubAdd={noop}
        onSubEdit={noop}
        onSubDelete={noop}
        onEditMapping={noop}
      />,
    );
    expect(screen.getByRole("heading", { name: "Colliers" })).toBeInTheDocument();
    expect(screen.getByText(/89 produits/)).toBeInTheDocument();
    expect(screen.getByText(/2 sous-catégories/)).toBeInTheDocument();
  });
  it("le bouton retour n'apparaît que si showBackButton=true", () => {
    const { rerender } = render(
      <CategoryDetail category={cat} showBackButton={false} onBack={noop} onEdit={noop} onDelete={noop} onSubAdd={noop} onSubEdit={noop} onSubDelete={noop} onEditMapping={noop} />,
    );
    expect(screen.queryByLabelText(/Retour/i)).not.toBeInTheDocument();
    rerender(
      <CategoryDetail category={cat} showBackButton onBack={noop} onEdit={noop} onDelete={noop} onSubAdd={noop} onSubEdit={noop} onSubDelete={noop} onEditMapping={noop} />,
    );
    expect(screen.getByLabelText(/Retour/i)).toBeInTheDocument();
  });
  it("click sur « Modifier » appelle onEdit", () => {
    const onEdit = vi.fn();
    render(
      <CategoryDetail category={cat} showBackButton={false} onBack={noop} onEdit={onEdit} onDelete={noop} onSubAdd={noop} onSubEdit={noop} onSubDelete={noop} onEditMapping={noop} />,
    );
    // 2 boutons "Modifier" rendus (mobile + desktop) — variante CSS uniquement,
    // le premier suffit à valider le câblage.
    fireEvent.click(screen.getAllByRole("button", { name: /^Modifier$/ })[0]);
    expect(onEdit).toHaveBeenCalled();
  });
  it("click sur « Supprimer » appelle onDelete", () => {
    const onDelete = vi.fn();
    render(
      <CategoryDetail category={cat} showBackButton={false} onBack={noop} onEdit={noop} onDelete={onDelete} onSubAdd={noop} onSubEdit={noop} onSubDelete={noop} onEditMapping={noop} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Supprimer$/ })[0]);
    expect(onDelete).toHaveBeenCalled();
  });
});
