/**
 * OrderContent — raccourci « Mettre en rupture de stock les variants cochés »
 *
 * La cliente a demandé une colonne « # » avec une case à cocher par variante,
 * un surlignage de la ligne cochée, et un bouton rouge qui apparaît à côté de
 * « Modifier la commande » dès qu'au moins une case est cochée. Ce test
 * vérifie :
 *  - La colonne « # » apparaît sur une commande PENDING (readOnly=false).
 *  - Cocher une variante fait apparaître le bouton rouge avec le compteur.
 *  - Cliquer sur le bouton appelle `modifyOrderItems` avec newQuantity=0 et
 *    reason=OUT_OF_STOCK pour les variantes cochées.
 *  - La colonne « # » n'apparaît pas en mode lecture seule (commande expédiée).
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const modifyOrderItemsMock = vi.fn().mockResolvedValue({ success: true });
vi.mock("@/app/actions/admin/orders", () => ({
  modifyOrderItems: (...args: unknown[]) => modifyOrderItemsMock(...args),
  addCompensationItemsBulk: vi.fn(),
  removeCompensationItem: vi.fn(),
  revertAllOrderItemModifications: vi.fn(),
  setOrderItemLineDiscount: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

// Le confirm renvoie true par défaut pour simuler « OK » de la cliente.
vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

// Les sous-composants d'édition ne sont pas concernés par ce test ; on les
// coupe pour garder le rendu minimal et stable.
vi.mock("@/components/admin/products/DownloadOverlayToggles", () => ({
  usePersistedOverlayToggles: () => ({ toggles: {}, setToggle: vi.fn() }),
  OverlayToggles: () => null,
}));

vi.mock("@/components/admin/products/ReferenceBadgePreview", () => ({
  default: () => null,
}));

import OrderContent from "@/components/admin/orders/OrderContent";

const BASE_ITEMS = [
  {
    id: "it-1",
    productName: "Collier Perle",
    productRef: "BJ-COL-001",
    colorName: "Doré",
    imagePath: null,
    saleType: "UNIT",
    packQty: null,
    size: "TU",
    sizesJson: null,
    unitPrice: 10,
    quantity: 2,
    lineTotal: 20,
    isCompensation: false,
    lineDiscountType: null,
    lineDiscountValue: null,
    lineDiscountAmt: null,
  },
  {
    id: "it-2",
    productName: "Collier Perle",
    productRef: "BJ-COL-001",
    colorName: "Argenté",
    imagePath: null,
    saleType: "UNIT",
    packQty: null,
    size: "TU",
    sizesJson: null,
    unitPrice: 10,
    quantity: 1,
    lineTotal: 10,
    isCompensation: false,
    lineDiscountType: null,
    lineDiscountValue: null,
    lineDiscountAmt: null,
  },
];

const BASE_TOTALS = {
  currentSubtotalHT: 30,
  paidSubtotalHT: 30,
  subtotalBrutHT: 30,
  clientDiscountAmt: 0,
  commercialGiftHT: 0,
  promoAutoDiscount: 0,
  promoDiscount: 0,
  promoCode: null,
  appliedPromotions: [],
  carrierName: "Chronopost",
  carrierPrice: 0,
  carrierBasePrice: 0,
  carrierPromoDiscount: 0,
  carrierClientDiscount: 0,
  tvaRate: 0.2,
  currentTotalTTC: 36,
  paidTotalTTC: 36,
  paymentStatus: "paid",
};

function renderComponent(overrides: Partial<React.ComponentProps<typeof OrderContent>> = {}) {
  return render(
    <OrderContent
      orderId="order-1"
      readOnly={false}
      items={BASE_ITEMS}
      modifications={[]}
      colorMap={{}}
      totals={BASE_TOTALS as React.ComponentProps<typeof OrderContent>["totals"]}
      productLinks={{}}
      {...overrides}
    />,
  );
}

describe("OrderContent — raccourci « Mettre en rupture de stock »", () => {
  it("affiche une case à cocher par variante en mode view (commande PENDING)", () => {
    renderComponent();

    const checkboxes = screen.getAllByRole("checkbox", {
      name: /sélectionner pour mise en rupture/i,
    });
    expect(checkboxes.length).toBe(2);
  });

  it("cocher une variante fait apparaître le bouton rouge avec le compteur", () => {
    renderComponent();

    // Pas de bouton rouge au départ.
    expect(
      screen.queryByRole("button", { name: /mettre en rupture de stock les variants cochés/i }),
    ).not.toBeInTheDocument();

    const [firstCheckbox] = screen.getAllByRole("checkbox", {
      name: /sélectionner pour mise en rupture/i,
    });
    fireEvent.click(firstCheckbox);

    expect(
      screen.getByRole("button", { name: /mettre en rupture de stock les variants cochés \(1\)/i }),
    ).toBeInTheDocument();
  });

  it("cliquer sur le bouton rouge appelle modifyOrderItems avec newQuantity=0 et reason=OUT_OF_STOCK", async () => {
    renderComponent();

    const checkboxes = screen.getAllByRole("checkbox", {
      name: /sélectionner pour mise en rupture/i,
    });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const bulkBtn = screen.getByRole("button", {
      name: /mettre en rupture de stock les variants cochés \(2\)/i,
    });
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      expect(modifyOrderItemsMock).toHaveBeenCalledTimes(1);
    });

    const [orderIdArg, mods] = modifyOrderItemsMock.mock.calls[0];
    expect(orderIdArg).toBe("order-1");
    expect(mods).toHaveLength(2);
    expect(mods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderItemId: "it-1", newQuantity: 0, reason: "OUT_OF_STOCK" }),
        expect.objectContaining({ orderItemId: "it-2", newQuantity: 0, reason: "OUT_OF_STOCK" }),
      ]),
    );
  });

  it("n'affiche pas la colonne # en lecture seule (commande expédiée)", () => {
    renderComponent({ readOnly: true });

    expect(
      screen.queryByRole("checkbox", { name: /sélectionner pour mise en rupture/i }),
    ).not.toBeInTheDocument();
  });
});
