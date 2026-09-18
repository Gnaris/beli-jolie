/**
 * ProductCardIssyma : la carte produit de la home Issyma doit masquer le prix
 * pour les visiteurs anonymes (canSeePrices=false) et le remplacer par un CTA
 * « Voir le tarif pro » + le sous-texte « Compte gratuit ». Décision cliente
 * du 2026-09-18 pour rendre la home cohérente avec le catalogue et la FAQ.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@/components/ui/SmartImage", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; sizes?: string; priority?: boolean }) => {
    const { fill: _f, sizes: _s, priority: _p, ...rest } = props;
    void _f; void _s; void _p;
    return <img alt="" {...rest} />;
  },
}));

import { ProductCardIssyma } from "@/components/home/layouts/HomeIssymaLayout";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const product: CarouselProduct = {
  id: "prod-1",
  name: "Bracelet doré",
  reference: "A123",
  category: "Bracelet",
  subCategory: null,
  tags: [],
  isBestSeller: false,
  isNew: true,
  discountPercent: null,
  colors: [
    {
      groupKey: "col-1",
      colorId: "col-1",
      hex: "#c0c0c0",
      patternImage: null,
      name: "Argent",
      firstImage: "/uploads/x.webp",
      unitPrice: 18,
      isPrimary: true,
      totalStock: 5,
      variants: [
        { id: "v-1", saleType: "UNIT", packQuantity: null, sizes: [], unitPrice: 18, stock: 5 },
      ],
    },
  ],
};

describe("ProductCardIssyma", () => {
  it("affiche le prix quand canSeePrices=true", () => {
    render(
      <ProductCardIssyma
        p={product}
        canSeePrices={true}
        pricePromptLabel="Voir le tarif pro"
        pricePromptHint="Compte gratuit"
      />,
    );
    expect(screen.getByText("18,00 €")).toBeInTheDocument();
    expect(screen.queryByText("Voir le tarif pro")).not.toBeInTheDocument();
    expect(screen.queryByText("Compte gratuit")).not.toBeInTheDocument();
  });

  it("masque le prix et affiche le CTA quand canSeePrices=false", () => {
    render(
      <ProductCardIssyma
        p={product}
        canSeePrices={false}
        pricePromptLabel="Voir le tarif pro"
        pricePromptHint="Compte gratuit"
      />,
    );
    expect(screen.queryByText("18,00 €")).not.toBeInTheDocument();
    expect(screen.getByText("Voir le tarif pro")).toBeInTheDocument();
    expect(screen.getByText("Compte gratuit")).toBeInTheDocument();
  });

  it("garde la carte cliquable vers la fiche produit même sans prix", () => {
    render(
      <ProductCardIssyma
        p={product}
        canSeePrices={false}
        pricePromptLabel="Voir le tarif pro"
        pricePromptHint="Compte gratuit"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toMatch(/^\/produits\//);
  });
});
