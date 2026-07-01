import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks pour tenir la modale isolée ─────────────────────────────────── */

// Sous-composants riches : on les remplace par des stubs statiques pour ne
// pas dépendre des server actions PFS/eFashion/Faire dans le test unitaire.
vi.mock("@/components/admin/MarketplaceMappingSection", () => ({
  __esModule: true,
  default: () => <div data-testid="pfs-mapping-section">MOCK_PFS</div>,
}));
vi.mock("@/components/admin/EfashionMappingPicker", () => ({
  __esModule: true,
  default: () => <div data-testid="efashion-picker">MOCK_EFASHION</div>,
}));
vi.mock("@/components/admin/FaireTaxonomySelect", () => ({
  __esModule: true,
  default: () => <div data-testid="faire-select">MOCK_FAIRE</div>,
}));
vi.mock("@/components/admin/pfs/PfsSuggestions", () => ({
  __esModule: true,
  default: () => <div data-testid="pfs-suggestions">MOCK_SUGGESTIONS</div>,
}));
vi.mock("@/components/admin/TranslateButton", () => ({
  __esModule: true,
  default: () => <button type="button">Traduire</button>,
}));

// Contextes / hooks utilisés par la modale.
vi.mock("@/components/admin/DeeplConfigContext", () => ({
  useAutoTranslateEnabled: () => false,
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Server actions : renvoient des valeurs neutres.
const mockCreateCategoryQuick = vi.fn(async () => ({ id: "cat-1", name: "Bague", subCategories: [] }));
vi.mock("@/app/actions/admin/quick-create", () => ({
  createCategoryQuick: (...a: unknown[]) => mockCreateCategoryQuick(...(a as [])),
}));
vi.mock("@/app/actions/admin/categories", () => ({
  updateCategoryFaireTaxonomy: vi.fn(async () => undefined),
}));
vi.mock("@/app/actions/admin/pfs-annexes", () => ({
  fetchPfsMappingOptions: vi.fn(async () => ({
    genders: [], families: [], categories: [], compositions: [], countries: [], seasons: [],
  })),
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

describe("CategoryEditorModal", () => {
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

  it("titre « Modifier la catégorie » en mode édition avec le nom", () => {
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: { fr: "Bague", en: "Ring" },
          pfsGender: "WOMAN",
          pfsFamilyName: "Bijoux_Fantaisie",
          pfsCategoryName: "Bagues",
          efashionCurrentId: 111,
          faireCurrentTaxonomyId: "tt_ring_01",
          onSave: async () => {},
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: /Modifier la catégorie « Bague »/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer les modifications/i })).toBeInTheDocument();
  });

  it("le bouton de création reste désactivé tant que le nom FR est vide", () => {
    render(<CategoryEditorModal open onClose={() => {}} />);
    const submit = screen.getByRole("button", { name: /Créer la catégorie/i });
    expect(submit).toBeDisabled();
  });

  it("en création, le bouton reste désactivé sans mapping PFS complet", () => {
    render(<CategoryEditorModal open onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText(/Ex : Bague, Collier/i);
    fireEvent.change(nameInput, { target: { value: "Bracelet" } });
    // PFS non rempli : bouton toujours désactivé
    expect(screen.getByRole("button", { name: /Créer la catégorie/i })).toBeDisabled();
    // Le message d'aide en pied invite à compléter PFS
    expect(screen.getByText(/Complète la correspondance Paris Fashion Shop/i)).toBeInTheDocument();
  });

  it("en édition, un simple renommage suffit — pas besoin de re-remplir PFS", () => {
    const onSave = vi.fn(async () => {});
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: { fr: "Bague" },
          pfsGender: null,
          pfsFamilyName: null,
          pfsCategoryName: null,
          efashionCurrentId: null,
          faireCurrentTaxonomyId: null,
          onSave,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Enregistrer les modifications/i })).not.toBeDisabled();
  });

  it("Cartes marketplaces : « Reliée » quand mapping présent, « Non reliée » sinon (édition)", () => {
    render(
      <CategoryEditorModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Bague",
          translations: { fr: "Bague" },
          pfsGender: "WOMAN",
          pfsFamilyName: "Bijoux_Fantaisie",
          pfsCategoryName: "Bagues",
          efashionCurrentId: 111,   // eFashion mappé
          faireCurrentTaxonomyId: null, // Faire non mappé
          onSave: async () => {},
        }}
      />,
    );
    // 2 marketplaces reliées sur 3 → header à droite doit l'annoncer
    expect(screen.getByText(/2 sur 3 reliées/i)).toBeInTheDocument();
    // On doit trouver au moins un statut « Non reliée » (Faire) et des « Reliée »
    expect(screen.getAllByText(/Reliée/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Non reliée/i)).toBeInTheDocument();
  });

  it("click sur « Annuler » appelle onClose", () => {
    const onClose = vi.fn();
    render(<CategoryEditorModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Annuler/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("click sur « Fermer » (croix) appelle onClose", () => {
    const onClose = vi.fn();
    render(<CategoryEditorModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Fermer/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
