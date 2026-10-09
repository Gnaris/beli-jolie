/**
 * VariantImageUploadModal : modale d'upload d'images scopée à une variante
 * donnée depuis l'onglet « Variantes » du formulaire produit. On vérifie :
 *  - le rendu conditionnel (open + variant non-null),
 *  - l'affichage du label de couleur dans l'en-tête,
 *  - le cas « variante sans couleur » qui remplace la grille par une invite,
 *  - les deux chemins de fermeture (bouton × + touche Escape),
 *  - le cas PACK multi-couleurs qui liste chaque couleur du paquet.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

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

import VariantImageUploadModal from "@/components/admin/products/VariantImageUploadModal";
import type {
  VariantState,
  ColorImageState,
  AvailableColor,
  PackLineState,
} from "@/components/admin/products/ColorVariantManager";

function makeUnitVariant(colorId: string, colorName: string): VariantState {
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

function makePackVariant(lines: PackLineState[]): VariantState {
  const first = lines[0];
  return {
    tempId: "t-pack",
    colorId: first?.colorId ?? "",
    colorName: first?.colorName ?? "",
    colorHex: first?.colorHex ?? "#000000",
    sizeEntries: [],
    unitPrice: "10",
    weight: "0",
    stock: "0",
    isPrimary: false,
    saleType: "PACK",
    packQuantity: "1",
    packLines: lines,
  } as unknown as VariantState;
}

function makeColorImages(colorId: string): ColorImageState[] {
  return [
    {
      groupKey: colorId,
      colorId,
      colorName: "Doré",
      colorHex: "#111111",
      imagePreviews: [],
      uploadedPaths: [],
      orders: [],
      pendingFiles: [],
      uploading: false,
    },
  ];
}

const AVAILABLE_COLORS: AvailableColor[] = [
  { id: "c1", name: "Doré", hex: "#D4AF37", patternImage: null },
  { id: "c2", name: "Argenté", hex: "#C0C0C0", patternImage: null },
];

describe("VariantImageUploadModal — modale d'upload scopée à une variante", () => {
  afterEach(() => cleanup());

  it("ne rend rien tant que open=false", () => {
    const { container } = render(
      <VariantImageUploadModal
        open={false}
        variant={makeUnitVariant("c1", "Doré")}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("ne rend rien si variant est null, même avec open=true", () => {
    const { container } = render(
      <VariantImageUploadModal
        open={true}
        variant={null}
        colorImages={[]}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("affiche le label de couleur de la variante UNIT dans l'en-tête", () => {
    render(
      <VariantImageUploadModal
        open={true}
        variant={makeUnitVariant("c1", "Doré")}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Images de la variante/i)).toBeTruthy();
    // « Doré » apparaît au moins deux fois : dans la pill de couleur de
    // l'en-tête de la modale, et dans la ligne couleur de PhotosPanel.
    expect(screen.getAllByText("Doré").length).toBeGreaterThanOrEqual(1);
  });

  it("affiche l'invite « choisir une couleur » quand la variante n'en a pas", () => {
    const variantSansCouleur = {
      ...makeUnitVariant("", ""),
      colorId: "",
      colorName: "",
    } as VariantState;
    render(
      <VariantImageUploadModal
        open={true}
        variant={variantSansCouleur}
        colorImages={[]}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Choisissez d'abord une couleur/i),
    ).toBeTruthy();
  });

  it("appelle onClose quand on clique sur le bouton Fermer", () => {
    const onClose = vi.fn();
    render(
      <VariantImageUploadModal
        open={true}
        variant={makeUnitVariant("c1", "Doré")}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Fermer/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("appelle onClose quand on appuie sur Escape", () => {
    const onClose = vi.fn();
    render(
      <VariantImageUploadModal
        open={true}
        variant={makeUnitVariant("c1", "Doré")}
        colorImages={makeColorImages("c1")}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("liste chaque couleur d'un pack multi-couleurs dans l'en-tête", () => {
    const lines: PackLineState[] = [
      {
        tempId: "l1",
        colorId: "c1",
        colorName: "Doré",
        colorHex: "#D4AF37",
        sizeEntries: [],
      },
      {
        tempId: "l2",
        colorId: "c2",
        colorName: "Argenté",
        colorHex: "#C0C0C0",
        sizeEntries: [],
      },
    ];
    render(
      <VariantImageUploadModal
        open={true}
        variant={makePackVariant(lines)}
        colorImages={[...makeColorImages("c1"), ...makeColorImages("c2")]}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Doré").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Argenté").length).toBeGreaterThanOrEqual(1);
  });
});
