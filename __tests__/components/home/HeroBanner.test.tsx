/**
 * HeroBanner : les 6 clés SiteConfig (surtitre, titre 1/2, description,
 * label + href du bouton secondaire) doivent prendre le pas sur les valeurs
 * i18n si elles sont fournies. Sinon on retombe sur les traductions génériques.
 *
 * On mocke next-intl + Link + SmartImage pour rendre le composant en
 * environnement jsdom sans monter le provider i18n.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({
  // Retourne la clé demandée pour que le test distingue « valeur override »
  // vs « fallback i18n » : un fallback affiché sera la chaîne littérale
  // « heroBadge », « heroTitle1 », etc.
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (key === "heroDesc" && params) return `heroDesc:${params.count}`;
    return key;
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/ui/SmartImage", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; sizes?: string; priority?: boolean }) => {
    const { fill: _f, sizes: _s, priority: _p, ...rest } = props;
    void _f; void _s; void _p;
    return <img alt="" {...rest} />;
  },
}));

import HeroBanner from "@/components/home/HeroBanner";

describe("HeroBanner", () => {
  it("utilise les traductions par défaut quand aucun override n'est fourni", () => {
    render(<HeroBanner bannerImage={null} shopName="ISSYMA" productCount={608} />);
    expect(screen.getByText("heroBadge")).toBeInTheDocument();
    expect(screen.getByText("heroTitle1")).toBeInTheDocument();
    expect(screen.getByText("heroTitle2")).toBeInTheDocument();
    expect(screen.getByText("heroDesc:608")).toBeInTheDocument();
    expect(screen.getByText("heroCta")).toBeInTheDocument();
    expect(screen.getByText("heroCtaSecondary")).toBeInTheDocument();
  });

  it("préfère les overrides SiteConfig sur les traductions", () => {
    render(
      <HeroBanner
        bannerImage={null}
        shopName="ISSYMA"
        productCount={608}
        heroEyebrow="Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers"
        heroTitleLine1="Des produits tendance"
        heroTitleLine2="pour votre boutique"
        heroDescription="Plus de 600 références disponibles pour les boutiques et revendeurs professionnels."
        heroCtaSecondaryLabel="Créer un compte professionnel"
        heroCtaSecondaryHref="/inscription"
      />,
    );
    expect(
      screen.getByText("Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers"),
    ).toBeInTheDocument();
    expect(screen.getByText("Créer un compte professionnel")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Créer un compte professionnel" }),
    ).toHaveAttribute("href", "/inscription");
    // Le compteur dynamique disparaît si une description custom est fournie.
    expect(screen.queryByText(/heroDesc:/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Plus de 600 références/),
    ).toBeInTheDocument();
  });

  it("ignore un override vide (chaîne blanche) et retombe sur i18n", () => {
    render(
      <HeroBanner
        bannerImage={null}
        shopName="ISSYMA"
        productCount={100}
        heroEyebrow="   "
        heroTitleLine1=""
      />,
    );
    expect(screen.getByText("heroBadge")).toBeInTheDocument();
    expect(screen.getByText("heroTitle1")).toBeInTheDocument();
  });

  it("cible par défaut /collections quand le lien secondaire n'est pas configuré", () => {
    render(<HeroBanner bannerImage={null} shopName="ISSYMA" productCount={0} />);
    expect(
      screen.getByRole("link", { name: "heroCtaSecondary" }),
    ).toHaveAttribute("href", "/collections");
  });
});
