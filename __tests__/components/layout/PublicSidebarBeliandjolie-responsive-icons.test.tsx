/**
 * Garde-fou : sur toute la plage desktop (≥1024 px, portables et 24"),
 * les icônes profil / favoris / panier doivent rester visibles pour une
 * cliente connectée.
 *
 * Historique : le choix 2026-09-28 (décalage « 15 % à gauche » + gaps 56 px +
 * 6 icônes à droite) faisait sortir le panier hors écran sur 1024-1700 px
 * (incident remonté par Marie-Alice). Correctif 2026-10-26 : padding plat
 * (`lg:pl-8`), nav resserrée (`gap-6 xl:gap-8 min-w-0`), actions épinglées
 * à droite + `shrink-0 gap-2`.
 *
 * On vérifie ici que :
 *  - la ligne logo/nav/actions NE réintroduit PAS `lg:pl-[15%]` ni `lg:gap-14`
 *  - le conteneur d'actions reste épinglé à droite (`ml-auto`) ET `shrink-0`
 *  - la nav est marquée `min-w-0` pour céder au lieu d'écraser les actions
 *  - l'icône panier (lien vers /panier) est bien rendue pour une CLIENT connectée.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        role: "CLIENT",
        status: "APPROVED",
        email: "marie@example.com",
        company: "Boutique Test",
      },
    },
    status: "authenticated",
  }),
  signOut: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fr",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, className, ...rest }: React.ComponentProps<"a">) => (
    <a href={href as string} className={className} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/ui/SmartImage", () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ""} />,
}));

vi.mock("@/components/layout/LanguageSwitcher", () => ({
  default: () => <div data-testid="lang-switcher" />,
}));

vi.mock("@/app/actions/admin/preview-mode", () => ({
  disableAdminPreview: vi.fn(),
}));

vi.mock("@/lib/verified-badge-state", () => ({
  getVerifiedBadgeState: () => ({ show: true, variant: "verified" }),
}));

vi.mock("@/lib/product-url", () => ({
  buildProductHandle: (name: string, ref: string) => `${name}-${ref}`,
}));

// fetch stub pour /api/cart/count
beforeAll(() => {
  // @ts-expect-error jsdom
  global.fetch = vi.fn(async () => ({ json: async () => ({ count: 0 }) }));
});

import PublicSidebarBeliandjolie from "@/components/layout/PublicSidebarBeliandjolie";

describe("PublicSidebarBeliandjolie — responsive icons (desktop 1024-1535 px)", () => {
  it("rend un lien panier accessible à la cliente connectée", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    const cartLinks = container.querySelectorAll('a[href="/panier"]');
    expect(cartLinks.length).toBeGreaterThan(0);
  });

  it("n'utilise plus `lg:pl-[15%]` ni `lg:gap-14` sur la ligne principale", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    const row = Array.from(container.querySelectorAll("header div")).find((el) => {
      const cls = (el as HTMLElement).className ?? "";
      return cls.includes("h-16") && cls.includes("flex") && cls.includes("items-center");
    }) as HTMLElement | undefined;
    expect(row).toBeTruthy();
    const cls = row!.className;
    expect(cls).toContain("lg:pl-8");
    expect(cls).toContain("lg:pr-8");
    // Régression 2026-09-28 : padding/gap massifs qui faisaient sortir le
    // panier hors écran. Ils ne doivent JAMAIS revenir.
    expect(cls).not.toMatch(/\blg:pl-\[15%\]/);
    expect(cls).not.toMatch(/\b2xl:pl-\[15%\]/);
    expect(cls).not.toMatch(/\blg:gap-14/);
    expect(cls).not.toMatch(/\b2xl:gap-14/);
  });

  it("épingle les actions à droite (`ml-auto` + `shrink-0`, sans `lg:ml-0`)", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    const cartLink = container.querySelector('a[href="/panier"]');
    const actionsRow = cartLink?.parentElement as HTMLElement | null;
    expect(actionsRow).toBeTruthy();
    const cls = actionsRow!.className;
    expect(cls).toContain("ml-auto");
    expect(cls).toContain("shrink-0");
    expect(cls).not.toMatch(/\blg:ml-0/);
  });

  it("laisse la nav céder (min-w-0) au lieu d'écraser les icônes", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    const nav = container.querySelector("header nav");
    expect(nav).toBeTruthy();
    const cls = (nav as HTMLElement).className;
    expect(cls).toContain("min-w-0");
    // La régression du gap-10 (trop large pour 7 liens) ne doit pas revenir
    expect(cls).not.toMatch(/\bgap-10\b/);
  });
});
