/**
 * PhotosPanel : le bouton « Définir comme principale » ne doit pas propager
 * le changement de couleur principale si la couleur n'a aucune photo. Un
 * toast d'erreur explique le motif à la cliente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const toastError = vi.fn();

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: toastError,
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

function makeColorImages(colorId: string, withPhoto: boolean): ColorImageState[] {
  return [
    {
      groupKey: colorId,
      colorId,
      colorName: "Doré",
      colorHex: "#111111",
      imagePreviews: withPhoto ? ["blob:fake"] : [],
      uploadedPaths: withPhoto ? ["/uploads/x.webp"] : [],
      orders: withPhoto ? [0] : [],
      pendingFiles: withPhoto ? [null] : [],
      uploading: false,
    },
  ];
}

const AVAILABLE_COLORS: AvailableColor[] = [
  { id: "c1", name: "Doré", hex: "#D4AF37", patternImage: null },
];

describe("PhotosPanel — garde-fou couleur principale sans photo", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => cleanup());

  it("bloque le passage en principale et affiche un toast d'erreur si la couleur n'a aucune photo", () => {
    const onChangePrimaryColorId = vi.fn();
    render(
      <PhotosPanel
        variants={[makeVariant("c1", "Doré")]}
        colorImages={makeColorImages("c1", false)}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={onChangePrimaryColorId}
      />,
    );

    const btn = screen.getByRole("button", {
      name: /Définir Doré comme couleur principale/i,
    });
    fireEvent.click(btn);

    expect(onChangePrimaryColorId).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toMatch(/Impossible de définir comme principale/i);
    expect(toastError.mock.calls[0][1]).toMatch(/aucune photo/i);
  });

  it("laisse passer le changement de couleur principale quand au moins une photo est présente", () => {
    const onChangePrimaryColorId = vi.fn();
    render(
      <PhotosPanel
        variants={[makeVariant("c1", "Doré")]}
        colorImages={makeColorImages("c1", true)}
        availableColors={AVAILABLE_COLORS}
        onChangeImages={vi.fn()}
        primaryColorId={null}
        onChangePrimaryColorId={onChangePrimaryColorId}
      />,
    );

    const btn = screen.getByRole("button", {
      name: /Définir Doré comme couleur principale/i,
    });
    fireEvent.click(btn);

    expect(onChangePrimaryColorId).toHaveBeenCalledWith("c1");
    expect(toastError).not.toHaveBeenCalled();
  });
});
