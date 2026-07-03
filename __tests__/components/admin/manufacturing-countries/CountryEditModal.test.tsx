import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/* ── Mocks pour isoler la modale ───────────────────────────────────────── */

vi.mock("@/components/admin/MarketplaceMappingSection", () => ({
  __esModule: true,
  default: () => <div data-testid="pfs-mapping-section">MOCK_PFS</div>,
}));
vi.mock("@/components/admin/EfashionMappingPicker", () => ({
  __esModule: true,
  default: () => <div data-testid="efashion-picker">MOCK_EFASHION</div>,
}));
vi.mock("@/components/admin/pfs/PfsSuggestions", () => ({
  __esModule: true,
  default: () => <div data-testid="pfs-suggestions">MOCK_SUGGESTIONS</div>,
}));
vi.mock("@/components/admin/TranslateButton", () => ({
  __esModule: true,
  default: () => <button type="button">Traduire</button>,
}));

vi.mock("@/components/admin/DeeplConfigContext", () => ({
  useAutoTranslateEnabled: () => false,
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const mockCreateCountryQuick = vi.fn(async () => ({ id: "c1", name: "Chine" }));
vi.mock("@/app/actions/admin/quick-create", () => ({
  createManufacturingCountryQuick: (...a: unknown[]) =>
    mockCreateCountryQuick(...(a as [])),
}));
vi.mock("@/app/actions/admin/pfs-annexes", () => ({
  fetchPfsMappingOptions: vi.fn(async () => ({
    genders: [],
    families: [],
    categories: [],
    compositions: [],
    countries: [],
    seasons: [],
  })),
}));

import CountryEditModal from "@/components/admin/manufacturing-countries/CountryEditModal";

/* ── Setup ─────────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("CountryEditModal", () => {
  it("ne rend rien quand open=false", () => {
    const { container } = render(
      <CountryEditModal open={false} onClose={() => {}} />,
    );
    expect(container.querySelector("h3")).toBeNull();
  });

  it("affiche le titre « Créer un pays » en mode création", () => {
    render(<CountryEditModal open onClose={() => {}} />);
    expect(
      screen.getByRole("heading", { name: /Créer un pays/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Créer$/i })).toBeInTheDocument();
  });

  it("affiche « Modifier le pays Chine » en mode édition", () => {
    render(
      <CountryEditModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Chine",
          translations: { en: "China" },
          isoCode: "CN",
          pfsCountryRef: "Chine",
          efashionCurrentId: 12,
          faireCountryCode: "CHN",
          onSave: async () => {},
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Modifier le pays Chine/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Enregistrer$/i }),
    ).toBeInTheDocument();
  });

  it("désactive le bouton Créer tant que le nom FR est vide", () => {
    render(<CountryEditModal open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^Créer$/i })).toBeDisabled();
  });

  it("désactive le bouton Créer sans correspondance PFS", () => {
    render(<CountryEditModal open onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText(/Ex: Chine, Turquie/i);
    fireEvent.change(nameInput, { target: { value: "Nouvelle Zélande" } });
    // Auto-suggest devrait poser un ISO ; sans PFS, bouton toujours désactivé
    expect(screen.getByRole("button", { name: /^Créer$/i })).toBeDisabled();
  });

  it("indique en pied que l'ISO est manquant si non déductible depuis le nom", () => {
    render(<CountryEditModal open onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText(/Ex: Chine, Turquie/i);
    // Un nom bidon sans correspondance ISO connue → l'auto-suggest reste vide
    fireEvent.change(nameInput, { target: { value: "Zzzzzzz" } });
    expect(screen.getByText(/Code ISO obligatoire\./i)).toBeInTheDocument();
  });

  it("affiche « Prêt à enregistrer » en édition quand tout est rempli", () => {
    render(
      <CountryEditModal
        open
        onClose={() => {}}
        editMode={{
          id: "c1",
          name: "Chine",
          translations: { en: "China" },
          isoCode: "CN",
          pfsCountryRef: "Chine",
          efashionCurrentId: null,
          faireCountryCode: "CHN",
          onSave: async () => {},
        }}
      />,
    );
    expect(screen.getByText(/Prêt à enregistrer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Enregistrer$/i })).not.toBeDisabled();
  });
});
