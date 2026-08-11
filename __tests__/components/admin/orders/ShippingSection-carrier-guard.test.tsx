/**
 * ShippingSection : le bouton « Générer le bordereau Easy-Express » ne doit
 * PAS être proposé quand la commande a été passée avec un mode qui ne passe
 * pas par Easy-Express (retrait en boutique ou transporteur privé du client).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/actions/admin/shipping", () => ({
  generateShipmentLabel: vi.fn(),
  setManualShipping: vi.fn(),
  clearShipping: vi.fn(),
}));

vi.mock("@/components/ui/LoadingOverlay", () => ({
  useLoadingOverlay: () => ({ showLoading: vi.fn(), hideLoading: vi.fn() }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("@/components/ui/CustomSelect", () => ({
  default: () => null,
}));

import ShippingSection from "@/components/admin/orders/ShippingSection";

const BASE_PROPS = {
  orderId: "o1",
  initialCarrierName: "FedEx International",
  initialTrackingId: null,
  initialLabelUrl: null,
  isOutsideEu: false,
};

describe("ShippingSection — garde selon carrierId", () => {
  it("masque le bouton Easy-Express quand carrierId = pickup_store", () => {
    render(<ShippingSection {...BASE_PROPS} carrierId="pickup_store" />);

    expect(
      screen.queryByRole("button", { name: /générer le bordereau easy-express/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /saisir/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/retrait en boutique/i)).toBeInTheDocument();
  });

  it("masque le bouton Easy-Express quand carrierId = private_carrier, garde la saisie manuelle", () => {
    render(<ShippingSection {...BASE_PROPS} carrierId="private_carrier" />);

    expect(
      screen.queryByRole("button", { name: /générer le bordereau easy-express/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/transporteur privé du client/i).length).toBeGreaterThan(0);
    // Un bouton de saisie manuelle reste dispo (au cas où le transporteur du
    // client communique un numéro de suivi).
    expect(
      screen.getByRole("button", { name: /saisir le suivi/i }),
    ).toBeInTheDocument();
  });

  it("propose le bouton Easy-Express pour un transporteur Easy-Express classique", () => {
    render(<ShippingSection {...BASE_PROPS} carrierId="cid-fedex" />);

    expect(
      screen.getByRole("button", { name: /générer le bordereau easy-express/i }),
    ).toBeInTheDocument();
  });
});
