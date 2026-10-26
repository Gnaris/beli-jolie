/**
 * Garde-fou : en lg (≥1024 px) et jusqu'à 2xl (1536 px), le header BJ doit
 * garder les icônes profil / favoris / panier accessibles. Avant 2026-10-26,
 * `lg:pl-[15%]` + `lg:ml-0` sur les actions faisait sortir ces icônes hors
 * écran sur les 14-15 pouces (≈1500 px), rendant le panier introuvable pour
 * les clientes connectées.
 *
 * On vérifie ici que :
 *  - la ligne logo/nav/actions utilise bien le padding progressif (lg → xl → 2xl)
 *  - le conteneur d'actions reste épinglé à droite (`ml-auto`, sans `lg:ml-0`)
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

  it("utilise un padding gauche progressif (lg:pl-8 xl:pl-16 2xl:pl-[15%])", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    const headerRow = container.querySelector("header > div.h-16, header > div.flex");
    // On cible la ligne principale par ses tokens exacts
    const row = Array.from(container.querySelectorAll("header div")).find((el) => {
      const cls = (el as HTMLElement).className ?? "";
      return cls.includes("h-16") && cls.includes("flex") && cls.includes("items-center");
    }) as HTMLElement | undefined;
    expect(row).toBeTruthy();
    const cls = row!.className;
    expect(cls).toContain("lg:pl-8");
    expect(cls).toContain("xl:pl-16");
    expect(cls).toContain("2xl:pl-[15%]");
    // Garde-fou : ne doit JAMAIS avoir un pl 15% dès `lg` (régression 2026-09-28)
    expect(cls).not.toMatch(/\blg:pl-\[15%\]/);
    expect(headerRow).toBeTruthy();
  });

  it("épingle les actions à droite (`ml-auto` sans `lg:ml-0`)", () => {
    const { container } = render(<PublicSidebarBeliandjolie shopName="Beli & Jolie" />);
    // Le conteneur d'actions contient le lien panier
    const cartLink = container.querySelector('a[href="/panier"]');
    const actionsRow = cartLink?.parentElement as HTMLElement | null;
    expect(actionsRow).toBeTruthy();
    const cls = actionsRow!.className;
    expect(cls).toContain("ml-auto");
    expect(cls).not.toMatch(/\blg:ml-0/);
  });
});
