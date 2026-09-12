/**
 * FeaturedProduct : les 3 produits mis en avant sur la home doivent respecter
 * la règle de visibilité des prix (canSeePrices). Visiteur anonyme / compte
 * PENDING → prix masqués + CTA « créer un compte », mention min. 100 € HT.
 *
 * On mocke next-intl, Link, SmartImage, useScrollReveal et useProductTranslation
 * pour rester sur du DOM pur sans provider ni fetch.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/ui/SmartImage", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; sizes?: string }) => {
    const { fill: _f, sizes: _s, ...rest } = props;
    void _f; void _s;
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/components/home/useScrollReveal", () => ({
  useScrollReveal: () => ({ current: null }),
}));

vi.mock("@/hooks/useProductTranslation", () => ({
  useProductTranslation: () => ({
    tp: (name: string) => name,
    tc: (cat: string) => cat,
  }),
}));

import FeaturedProduct from "@/components/home/FeaturedProduct";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const PRODUCTS: CarouselProduct[] = [1, 2, 3].map((n) => ({
  id: `p${n}`,
  name: `Produit ${n}`,
  reference: `R${n}`,
  category: "Robes",
  subCategory: null,
  tags: [],
  isBestSeller: false,
  isNew: false,
  discountPercent: null,
  colors: [
    {
      groupKey: `p${n}-c1`,
      colorId: "c1",
      hex: "#000",
      patternImage: null,
      name: "Noir",
      firstImage: "/uploads/x.webp",
      unitPrice: 12.5,
      isPrimary: true,
      totalStock: 5,
      variants: [
        { id: `v${n}`, saleType: "UNIT", packQuantity: null, sizes: [], unitPrice: 12.5, stock: 5 },
      ],
    },
  ],
}));

describe("FeaturedProduct", () => {
  it("affiche les prix des 3 produits quand canSeePrices=true", () => {
    render(<FeaturedProduct products={PRODUCTS} shopName="ISSYMA" canSeePrices />);
    // Prix formaté français « 12,50 € » présent 3 fois (un par produit).
    expect(screen.getAllByText(/12,50 €/)).toHaveLength(3);
    // Le CTA « catalogue » standard est actif, pas le CTA d'inscription.
    expect(screen.getByRole("link", { name: /featuredCta/ })).toHaveAttribute("href", "/produits");
    expect(screen.queryByText("featuredPriceHiddenCta")).not.toBeInTheDocument();
    // La mention du minimum de commande reste toujours visible.
    expect(screen.getByText("featuredMinOrder")).toBeInTheDocument();
  });

  it("masque les prix et affiche le CTA « créer un compte » quand canSeePrices=false", () => {
    render(<FeaturedProduct products={PRODUCTS} shopName="ISSYMA" canSeePrices={false} />);
    expect(screen.queryByText(/12,50 €/)).not.toBeInTheDocument();
    // Chaque tuile affiche la mention « tarifs réservés ».
    expect(screen.getAllByText("featuredPriceHiddenTitle")).toHaveLength(3);
    const cta = screen.getByRole("link", { name: /featuredPriceHiddenCta/ });
    expect(cta).toHaveAttribute("href", "/inscription");
    expect(screen.getByText("featuredMinOrder")).toBeInTheDocument();
  });

  it("ne rend rien si moins de 3 produits fournis", () => {
    const { container } = render(
      <FeaturedProduct products={PRODUCTS.slice(0, 2)} shopName="ISSYMA" canSeePrices />,
    );
    expect(container.firstChild).toBeNull();
  });
});
