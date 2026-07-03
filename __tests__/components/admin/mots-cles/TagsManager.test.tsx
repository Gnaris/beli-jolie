import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks ───────────────────────────────────────────────────────────── */

vi.mock("@/components/admin/products/QuickCreateModal", () => ({
  __esModule: true,
  default: () => <div data-testid="quick-create-modal">MOCK_MODAL</div>,
}));
vi.mock("@/components/admin/TranslateAllButton", () => ({
  __esModule: true,
  default: () => <button type="button">Tout traduire</button>,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/actions/admin/products", () => ({
  deleteTag: vi.fn(async () => undefined),
  updateTagDirect: vi.fn(async () => undefined),
}));
vi.mock("@/app/actions/admin/batch-translations", () => ({
  batchUpdateTranslations: vi.fn(async () => undefined),
}));

import TagsManager from "@/app/(admin)/admin/mots-cles/TagsManager";

const TAGS = [
  { id: "t1", name: "tendance", productCount: 128, translations: { en: "trendy" } },
  { id: "t2", name: "bohème", productCount: 73, translations: {} },
  { id: "t3", name: "rétro", productCount: 0, translations: {} },
  { id: "t4", name: "argenté", productCount: 52, translations: { en: "silver" } },
];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("TagsManager", () => {
  it("affiche tous les mots-clés dans la grille", () => {
    render(<TagsManager initialTags={TAGS} />);
    expect(screen.getByText("tendance")).toBeInTheDocument();
    expect(screen.getByText("bohème")).toBeInTheDocument();
    expect(screen.getByText("rétro")).toBeInTheDocument();
    expect(screen.getByText("argenté")).toBeInTheDocument();
  });

  it("marque comme inutilisé un mot-clé à 0 produit", () => {
    render(<TagsManager initialTags={TAGS} />);
    expect(screen.getByText(/0 · inutilisé/i)).toBeInTheDocument();
  });

  it("filtre les mots-clés via la recherche", () => {
    render(<TagsManager initialTags={TAGS} />);
    const input = screen.getByPlaceholderText(/Rechercher un mot-clé/i);
    fireEvent.change(input, { target: { value: "boh" } });
    expect(screen.getByText("bohème")).toBeInTheDocument();
    expect(screen.queryByText("tendance")).toBeNull();
    expect(screen.queryByText("argenté")).toBeNull();
  });

  it("filtre aussi via la traduction anglaise", () => {
    render(<TagsManager initialTags={TAGS} />);
    const input = screen.getByPlaceholderText(/Rechercher un mot-clé/i);
    fireEvent.change(input, { target: { value: "silver" } });
    expect(screen.getByText("argenté")).toBeInTheDocument();
    expect(screen.queryByText("tendance")).toBeNull();
  });

  it("tri A→Z réordonne la grille alphabétiquement", () => {
    const { container } = render(<TagsManager initialTags={TAGS} />);
    // Bascule sur A→Z
    fireEvent.click(screen.getByRole("button", { name: /A → Z/i }));
    // Récupère les noms visibles dans l'ordre du DOM
    const names = Array.from(container.querySelectorAll(".font-semibold.text-\\[15px\\]"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    // Ordre alphabétique fr : argenté, bohème, rétro, tendance
    expect(names).toEqual(["argenté", "bohème", "rétro", "tendance"]);
  });

  it("compteur en pied indique le nombre affiché", () => {
    render(<TagsManager initialTags={TAGS} />);
    expect(screen.getByText(/4 mots-clés affichés/i)).toBeInTheDocument();
  });

  it("affiche un état vide clair quand la recherche ne matche rien", () => {
    render(<TagsManager initialTags={TAGS} />);
    const input = screen.getByPlaceholderText(/Rechercher un mot-clé/i);
    fireEvent.change(input, { target: { value: "zzzz-inconnu" } });
    expect(screen.getByText(/Aucun mot-clé trouvé/i)).toBeInTheDocument();
  });
});
