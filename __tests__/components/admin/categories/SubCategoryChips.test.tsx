import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SubCategoryChips from "@/components/admin/categories/SubCategoryChips";

const SUBS = [
  { id: "s1", name: "Court", translations: { fr: "Court", en: "Short" } },
  { id: "s2", name: "Long", translations: { fr: "Long" } },
];

describe("SubCategoryChips", () => {
  it("rend une pastille par sous-catégorie et un chip + ajouter", () => {
    render(<SubCategoryChips subs={SUBS} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("Court")).toBeInTheDocument();
    expect(screen.getByText("Long")).toBeInTheDocument();
    expect(screen.getByText(/ajouter/i)).toBeInTheDocument();
  });
  it("marque l'absence de traduction (data-translated=false)", () => {
    render(<SubCategoryChips subs={SUBS} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    const longChip = screen.getByText("Long").closest('[data-sub-id="s2"]');
    expect(longChip?.querySelector('[data-translated="false"]')).toBeTruthy();
    const courtChip = screen.getByText("Court").closest('[data-sub-id="s1"]');
    expect(courtChip?.querySelector('[data-translated="true"]')).toBeTruthy();
  });
  it("click sur le × appelle onDelete avec l'id", () => {
    const onDelete = vi.fn();
    render(<SubCategoryChips subs={SUBS} onAdd={() => {}} onEdit={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText(/Supprimer Court/i));
    expect(onDelete).toHaveBeenCalledWith(SUBS[0]);
  });
  it("click sur le nom appelle onEdit avec la sous-cat", () => {
    const onEdit = vi.fn();
    render(<SubCategoryChips subs={SUBS} onAdd={() => {}} onEdit={onEdit} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("Court"));
    expect(onEdit).toHaveBeenCalledWith(SUBS[0]);
  });
  it("click sur + ajouter appelle onAdd", () => {
    const onAdd = vi.fn();
    render(<SubCategoryChips subs={SUBS} onAdd={onAdd} onEdit={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByText(/ajouter/i));
    expect(onAdd).toHaveBeenCalled();
  });
});
