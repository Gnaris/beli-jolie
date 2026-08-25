/**
 * PhotosPanel : cliquer sur une photo déjà téléversée ouvre une feuille
 * d'actions (« Voir en grand » + boutons de téléchargement WebP / PNG /
 * JPEG). Ce comportement rend la section utilisable en mobile — où le
 * survol n'existe pas — sans casser le drag & drop en desktop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("@/components/ui/ColorSwatch", () => ({
  default: () => null,
}));

import PhotosPanel from "@/components/admin/products/PhotosPanel";
import type { VariantState, ColorImageState, AvailableColor } from "@/components/admin/products/ColorVariantManager";

function makeVariant(colorId: string, colorName: string): VariantState {
  return {
    tempId: `t-${colorId}`,
    colorId,
    colorName,
    colorHex: "#111111",
    sizeEntries: [],
    unitPrice: "10",
    weight: "0",
    stock: "0",
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: "1",
    packLines: [],
  } as unknown as VariantState;
}

function makeColorImages(colorId: string): ColorImageState[] {
  return [
    {
      groupKey: colorId,
      colorId,
      colorName: "Doré",
      colorHex: "#111111",
      imagePreviews: ["/uploads/photo-1.webp"],
      uploadedPaths: ["/uploads/photo-1.webp"],
      orders: [0],
      pendingFiles: [null],
      uploading: false,
    },
  ];
}

const AVAILABLE_COLORS: AvailableColor[] = [
  { id: "c1", name: "Doré", hex: "#D4AF37", patternImage: null },
];

describe("PhotosPanel — feuille d'actions au clic sur une photo", () => {
  beforeEach(() => {
    // Par défaut : pas de Web Share fichier (comportement dev HTTP / desktop
    // Firefox…). Les tests qui veulent le contexte HTTPS + iOS réinstallent
    // les mocks localement.
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window.navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
  });
  afterEach(() => cleanup());

  it("sans Web Share : affiche « Voir en grand » + WebP/PNG/JPEG, PAS de « Enregistrer dans mes photos »", () => {
    render(
      <PhotosPanel
        variants={[makeVariant("c1", "Doré")]}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId="c1"
        onChangePrimaryColorId={vi.fn()}
      />,
    );

    // La tuile remplie est exposée en rôle button avec un aria-label explicite.
    const tile = screen.getByRole("button", {
      name: /Photo en position 1 — ouvrir les actions/i,
    });
    fireEvent.click(tile);

    const dialog = screen.getByRole("dialog", { name: /Actions photo/i });
    expect(dialog).toBeTruthy();

    // Voir en grand
    expect(within(dialog).getByRole("button", { name: /Voir en grand/i })).toBeTruthy();
    // Trois boutons de format toujours visibles
    expect(within(dialog).getByRole("button", { name: /^WEBP$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^PNG$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^JPEG$/i })).toBeTruthy();
    // Pas de bouton « Enregistrer dans mes photos » quand le partage n'est pas dispo
    expect(within(dialog).queryByRole("button", { name: /Enregistrer dans mes photos/i })).toBeNull();
  });

  it("avec Web Share fichier (HTTPS prod iOS/Android) : « Enregistrer dans mes photos » S'AJOUTE aux 3 formats", () => {
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(window.navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });

    render(
      <PhotosPanel
        variants={[makeVariant("c1", "Doré")]}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId="c1"
        onChangePrimaryColorId={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Photo en position 1 — ouvrir les actions/i }),
    );

    const dialog = screen.getByRole("dialog", { name: /Actions photo/i });
    // Les 3 sections coexistent
    expect(within(dialog).getByRole("button", { name: /Voir en grand/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Enregistrer dans mes photos/i })).toBeTruthy();
    // Les boutons de format restent affichés (téléchargement vers Fichiers)
    expect(within(dialog).getByRole("button", { name: /^WEBP$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^PNG$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^JPEG$/i })).toBeTruthy();
  });

  it("le clic sur « Voir en grand » ferme la feuille d'actions et bascule sur le viewer plein écran", () => {
    render(
      <PhotosPanel
        variants={[makeVariant("c1", "Doré")]}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId="c1"
        onChangePrimaryColorId={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Photo en position 1 — ouvrir les actions/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Voir en grand/i }),
    );

    // La feuille d'actions est fermée : plus de dialog « Actions photo ».
    expect(screen.queryByRole("dialog", { name: /Actions photo/i })).toBeNull();
    // Le viewer plein écran affiche un bouton « Fermer l'aperçu ».
    expect(screen.getByRole("button", { name: /Fermer l'aperçu/i })).toBeTruthy();
  });
});
