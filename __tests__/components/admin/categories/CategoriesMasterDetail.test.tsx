import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks — on isole la logique de sélection/URL, pas les sous-modales ─── */

const routerReplaceMock = vi.fn();
const routerRefreshMock = vi.fn();

// On enveloppe replaceState pour à la fois observer les appels ET synchroniser
// notre "vue" de searchParams — sans ça, useSearchParams garderait la valeur
// initiale et l'effet 91 de resync URL→state annulerait la sélection différée.
const realReplaceState = window.history.replaceState.bind(window.history);
let currentSearch = "";
const replaceStateSpy = vi.fn((state: unknown, unused: string, url?: string | null) => {
  if (typeof url === "string") {
    const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    currentSearch = q;
  }
  realReplaceState(state, unused, url ?? null);
});
window.history.replaceState = replaceStateSpy as typeof window.history.replaceState;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    replace: routerReplaceMock,
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(currentSearch),
  usePathname: () => "/admin/categories",
}));

vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/app/actions/admin/categories", () => ({
  deleteCategory: vi.fn(),
  deleteSubCategory: vi.fn(),
  reorderCategories: vi.fn(),
  updateCategoryDirect: vi.fn(),
  updateCategoryMicrostoreMapping: vi.fn(),
  updateSubCategoryDirect: vi.fn(),
  updateSubCategoryMicrostoreMapping: vi.fn(),
}));

// Sous-composants remplacés par des stubs légers : on ne teste que la logique
// de sélection différée dans le master-detail, pas le rendu de la liste ou de
// la modale interne.
vi.mock("@/components/admin/categories/CategoriesList", () => ({
  __esModule: true,
  default: () => <div data-testid="categories-list" />,
}));
vi.mock("@/components/admin/categories/CategoryDetail", () => ({
  __esModule: true,
  default: ({ category }: { category: { id: string; name: string } }) => (
    <div data-testid="category-detail" data-cat-id={category.id}>
      {category.name}
    </div>
  ),
}));
vi.mock("@/components/admin/products/QuickCreateModal", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/categories/OrderchampMappingDrawer", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/shared/mapping-modals/PfsCategoryMappingModal", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/shared/mapping-modals/EfashionMappingModal", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/shared/mapping-modals/FaireCategoryMappingModal", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/shared/mapping-modals/MicrostoreMappingModal", () => ({
  __esModule: true,
  default: () => null,
}));

// La modale de création exposée comme un bouton `onCreated` déclencheur — on
// simule ainsi le retour de createCategoryQuick sans monter la vraie modale.
vi.mock("@/components/admin/categories/CategoryEditorModal", () => ({
  __esModule: true,
  default: ({
    open,
    onCreated,
    editMode,
  }: {
    open: boolean;
    onCreated?: (item: { id: string; name: string }) => void;
    editMode?: { id: string };
  }) => {
    if (!open) return null;
    if (editMode) return <div data-testid="category-editor-edit" />;
    return (
      <button
        type="button"
        data-testid="fire-created"
        onClick={() => onCreated?.({ id: "new-cat-id", name: "Nouvelle" })}
      >
        Fire onCreated
      </button>
    );
  },
}));

import CategoriesMasterDetail, {
  type CategoryRow,
} from "@/components/admin/categories/CategoriesMasterDetail";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function makeCat(id: string, name: string, position: number): CategoryRow {
  return {
    id,
    name,
    position,
    translations: {},
    pfsCategoryId: null,
    pfsGender: null,
    pfsFamilyName: null,
    pfsCategoryName: null,
    efashionCategorieId: null,
    faireTaxonomyId: null,
    orderchampCategoryPath: null,
    microstoreCategoryId: null,
    microstoreLabel: null,
    productCount: 0,
    createdAt: new Date(),
    subCategories: [],
    pfsLabel: null,
    efashionLabel: null,
    faireLabel: null,
    orderchampLabel: null,
  };
}

const initialCats: CategoryRow[] = [
  makeCat("cat-a", "Bague", 0),
  makeCat("cat-x", "Collier", 1),
  makeCat("cat-b", "Bracelet", 2),
];

/* ── Setup ─────────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  currentSearch = "cat=cat-x";
  replaceStateSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("CategoriesMasterDetail — ajout optimiste après création", () => {
  it("ajoute la catégorie localement sans router.refresh ni router.replace", () => {
    render(
      <CategoriesMasterDetail
        categories={initialCats}
        hasPfsConfig
        hasEfashionConfig
        hasFaireConfig
        hasOrderchampConfig
        orderchampTaxonomy={[]}
      />,
    );

    // Ouvre la modale de création (bouton caché déclenché par le header)
    fireEvent.click(document.querySelector("[data-trigger-create-category]") as HTMLElement);
    // Simule le retour de createCategoryQuick avec un ID nouveau
    fireEvent.click(screen.getByTestId("fire-created"));

    // Ni router.refresh(), ni router.replace() : la mise à jour est purement locale.
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("sélectionne immédiatement la nouvelle catégorie et synchronise l'URL", () => {
    render(
      <CategoriesMasterDetail
        categories={initialCats}
        hasPfsConfig
        hasEfashionConfig
        hasFaireConfig
        hasOrderchampConfig
        orderchampTaxonomy={[]}
      />,
    );

    fireEvent.click(document.querySelector("[data-trigger-create-category]") as HTMLElement);
    fireEvent.click(screen.getByTestId("fire-created"));

    // La nouvelle cat, ajoutée optimistement, est déjà dans le détail.
    const detail = screen.getByTestId("category-detail");
    expect(detail.getAttribute("data-cat-id")).toBe("new-cat-id");
    expect(detail.textContent).toBe("Nouvelle");

    // URL synchronisée via history.replaceState (pas router.replace).
    expect(routerReplaceMock).not.toHaveBeenCalled();
    const lastCall = replaceStateSpy.mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("cat=new-cat-id");
  });
});
