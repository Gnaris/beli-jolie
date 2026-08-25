import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks ─────────────────────────────────────────────────────────────── */

vi.mock("@/components/admin/TranslateButton", () => ({
  __esModule: true,
  default: () => <button type="button">Traduire</button>,
}));
vi.mock("@/components/admin/TranslatingInput", () => ({
  __esModule: true,
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/hooks/useAutoTranslateOnBlur", () => ({
  useAutoTranslateOnBlur: () => ({ handleFrBlur: () => {}, isTranslating: () => false }),
}));

vi.mock("@/components/admin/DeeplConfigContext", () => ({
  useAutoTranslateEnabled: () => false,
}));

const mockCreateCategoryQuick = vi.fn(async () => ({
  id: "cat-1",
  name: "Bague",
  subCategories: [],
}));
vi.mock("@/app/actions/admin/quick-create", () => ({
  createCategoryQuick: (...a: unknown[]) => mockCreateCategoryQuick(...(a as [])),
}));

import CategoryEditorModal from "@/components/admin/categories/CategoryEditorModal";

/* ── Setup ─────────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("CategoryEditorModal (allégé)", () => {
  it("ne rend rien quand open=false", () => {
    const { container } = render(
      <CategoryEditorModal open={false} onClose={() => {}} />,
    );
    expect(container.querySelector("h3")).toBeNull();
  });

  it("titre « Créer une catégorie » en mode création", () => {
    render(<CategoryEditorModal open onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /Créer une catégorie/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Créer la catégorie/i })).toBeInTheDocument();
  });

  it("titre « Renommer » en mode édition avec le nom", () => {
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: { en: "Ring" },
          onSave: async () => {},
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /Renommer « Bague »/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer/i })).toBeInTheDocument();
  });

  it("ne contient PLUS de cartes marketplace (elles ont été extraites en mini-modals)", () => {
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: {},
          onSave: async () => {},
        }}
      />,
    );
    expect(screen.queryByText(/Paris Fashion Shop/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eFashion Paris/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Faire$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Microstore$/i)).not.toBeInTheDocument();
  });

  it("le bouton de création reste désactivé tant que le nom FR est vide", () => {
    render(<CategoryEditorModal open onClose={() => {}} />);
    const submit = screen.getByRole("button", { name: /Créer la catégorie/i });
    expect(submit).toBeDisabled();
  });

  it("bouton actif dès qu'un nom FR est saisi — plus de contrainte PFS", () => {
    render(<CategoryEditorModal open onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText(/Ex : Bague, Collier/i);
    fireEvent.change(nameInput, { target: { value: "Bracelet" } });
    expect(screen.getByRole("button", { name: /Créer la catégorie/i })).not.toBeDisabled();
  });

  it("création : appelle createCategoryQuick avec juste les traductions", async () => {
    const onClose = vi.fn();
    render(<CategoryEditorModal open onClose={onClose} />);
    const nameInput = screen.getByPlaceholderText(/Ex : Bague, Collier/i);
    fireEvent.change(nameInput, { target: { value: "Bracelet" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer la catégorie/i }));
    await waitFor(() => expect(mockCreateCategoryQuick).toHaveBeenCalled());
    const args = mockCreateCategoryQuick.mock.calls[0];
    expect(args[0]).toEqual({ fr: "Bracelet" });
  });

  it("édition : appelle editMode.onSave(name, translations)", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: { en: "Ring" },
          onSave,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("Bague", { en: "Ring" });
  });

  it("click sur « Annuler » appelle onClose", () => {
    const onClose = vi.fn();
    render(<CategoryEditorModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Annuler$/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("click sur « Fermer » (croix) appelle onClose", () => {
    const onClose = vi.fn();
    render(<CategoryEditorModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Fermer/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
