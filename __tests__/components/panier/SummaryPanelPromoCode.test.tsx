/**
 * SummaryPanel — vérifie l'affichage du code promo saisi :
 *   1. sans code promo → aucune ligne « Code promo »
 *   2. code promo sur les produits → ligne verte + « Total après code promo »
 *      dans la section panier
 *   3. code promo sur la livraison → ligne verte + « Livraison après code
 *      promo » dans la section livraison
 *
 * On mocke next-intl (retour de la clé) et useProductTranslation (identité).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  },
}));

vi.mock("@/hooks/useProductTranslation", () => ({
  useProductTranslation: () => ({ tp: (v: string) => v }),
}));

import SummaryPanel from "@/components/panier/wizard/SummaryPanel";
import type { WizardCart } from "@/components/panier/wizard/types";

function makeCart(): WizardCart {
  return {
    id: "cart-1",
    items: [
      {
        id: "line-1",
        quantity: 2,
        variant: {
          id: "v-1",
          productId: "p-1",
          colorId: null,
          unitPrice: 20,
          weight: 100,
          saleType: "UNIT",
          packQuantity: null,
          product: {
            id: "p-1",
            name: "Bracelet doré",
            reference: "REF1",
            status: "ONLINE",
            discountPercent: null,
            category: { name: "Bracelet" },
          },
        },
      },
    ],
  };
}

const baseProps = {
  cart: makeCart(),
  promoInfoByItemId: {},
  currentStep: 3 as const,
  cartCascade: {
    subtotalBrutHT: 40,
    subtotalHT: 40,
    clientDiscountAmt: 0,
    subtotalAfterDiscount: 40,
    discountTrace: [],
  },
  cartFallbackSubtotal: 40,
  shippingTrace: [],
  effectiveCarrierPrice: 10,
  carrierBasePrice: 10,
  tvaLabel: "20 %",
  tvaOnCart: 8,
  tvaOnShipping: 2,
  totalTTC: 60,
  deliveryMode: "delivery" as const,
  selectedCarrier: { id: "c1", name: "Colissimo", price: 10, delay: "48 h" },
  selectedMergeOrder: null,
  ctaLabel: "Payer",
  onCta: () => {},
};

describe("SummaryPanel — code promo saisi", () => {
  it("sans code promo, aucune ligne « Code promo » ne s'affiche", () => {
    render(<SummaryPanel {...baseProps} promoApplied={null} />);
    expect(screen.queryByText("summaryPromoCode")).toBeNull();
    expect(screen.queryByText("summaryAfterPromoCode")).toBeNull();
    expect(screen.queryByText("summaryShippingAfterPromoCode")).toBeNull();
  });

  it("code promo sur produits : affiche la ligne verte dans la section panier", () => {
    render(
      <SummaryPanel
        {...baseProps}
        promoApplied={{
          code: "ETE2026",
          name: "Été 2026",
          totalSaved: 5,
          itemsSaved: 5,
          shippingSaved: 0,
        }}
      />,
    );
    expect(screen.getByText("summaryPromoCode")).toBeInTheDocument();
    expect(screen.getByText("(ETE2026)")).toBeInTheDocument();
    expect(screen.getByText("−5.00 €")).toBeInTheDocument();
    expect(screen.getByText("summaryAfterPromoCode")).toBeInTheDocument();
    // Pas de ligne côté livraison
    expect(screen.queryByText("summaryShippingAfterPromoCode")).toBeNull();
  });

  it("code promo PERCENTAGE : affiche « −10 % » à côté du code dans le récap", () => {
    render(
      <SummaryPanel
        {...baseProps}
        promoApplied={{
          code: "NEW10",
          name: "New 10",
          totalSaved: 93.2,
          itemsSaved: 93.2,
          shippingSaved: 0,
          discountKind: "PERCENTAGE",
          discountValue: 10,
        }}
      />,
    );
    expect(screen.getByText("(NEW10)")).toBeInTheDocument();
    expect(screen.getByText("−10%")).toBeInTheDocument();
  });

  it("code promo sur livraison : affiche la ligne verte dans la section livraison", () => {
    render(
      <SummaryPanel
        {...baseProps}
        promoApplied={{
          code: "FRAISOFF",
          name: "Livraison offerte",
          totalSaved: 10,
          itemsSaved: 0,
          shippingSaved: 10,
        }}
      />,
    );
    expect(screen.getByText("summaryPromoCode")).toBeInTheDocument();
    expect(screen.getByText("(FRAISOFF)")).toBeInTheDocument();
    expect(screen.getByText("summaryShippingAfterPromoCode")).toBeInTheDocument();
    // Pas de ligne côté panier
    expect(screen.queryByText("summaryAfterPromoCode")).toBeNull();
  });
});
