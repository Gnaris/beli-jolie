/**
 * HeroInfoFaq (refonte home BJ 2026-09-28) — vérifie que :
 *  - Le bloc info affiche titre + les 6 lignes attendues (traductions + count
 *    produits/catégories/showroom passés depuis le layout).
 *  - La FAQ ouvre le 1er item par défaut (openId = faqItems[0].id) et permet
 *    de switcher via clic.
 *  - Les CTA hero pointent bien vers /inscription et /produits.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// useSession est mocké — chaque test peut réécrire la valeur retournée
// via mockUseSession.mockReturnValue({...}).
const mockUseSession = vi.fn(() => ({ data: null, status: "unauthenticated" }));
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

import HeroInfoFaq from "@/components/home/HeroInfoFaq";

const baseProps = {
  productCount: 10321,
  categoryCount: 19,
  showroomAddress: "90 rue de la Haie Coq, 93300 Aubervilliers",
  showroomHours: "Lundi–Vendredi 8h30–19h · Samedi 13h–19h · Dimanche fermé",
  faqItems: [
    { id: "q1", question: "Question 1 ?", answer: "Réponse 1." },
    { id: "q2", question: "Question 2 ?", answer: "Réponse 2." },
    { id: "q3", question: "Question 3 ?", answer: "Réponse 3." },
  ],
  companyPhone: "+33 1 23 45 67 89" as string | null,
  companyWhatsapp: null as string | null,
};

describe("HeroInfoFaq", () => {
  it("affiche H1 SEO, eyebrow marque, sous-titre et injecte count produits + catégories dans la ligne catalogue", () => {
    render(<HeroInfoFaq {...baseProps} />);

    // Le H1 SEO utilise la clé i18n dédiée (pas le nom de marque en dur)
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("heroInfo.h1");
    // La marque + ville apparaît en eyebrow au-dessus du H1
    expect(screen.getByText("heroInfo.eyebrow")).toBeInTheDocument();
    // Sous-titre = clé traduction retournée telle quelle par le mock
    expect(screen.getByText("heroInfo.subtitle")).toBeInTheDocument();
    // Ligne catalogue = count formaté fr-FR (10 321) + catCount = 19
    expect(screen.getByText(/"count":"10\s?321"/)).toBeInTheDocument();
    expect(screen.getByText(/"catCount":19/)).toBeInTheDocument();
  });

  it("passe l'adresse et les horaires du showroom aux clés i18n dédiées", () => {
    render(<HeroInfoFaq {...baseProps} />);

    // Les 2 clés reçoivent leurs params → texte contient le JSON stringifié
    expect(
      screen.getByText(/"address":"90 rue de la Haie Coq, 93300 Aubervilliers"/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"hours":"Lundi–Vendredi 8h30–19h · Samedi 13h–19h · Dimanche fermé"/)
    ).toBeInTheDocument();
  });

  it("visiteur non connecté : CTA principal = « Ouvrir un compte pro » → /inscription", () => {
    mockUseSession.mockReturnValueOnce({ data: null, status: "unauthenticated" });
    render(<HeroInfoFaq {...baseProps} />);

    const registerLink = screen.getByText("heroInfo.ctaOpenAccount").closest("a");
    expect(registerLink?.getAttribute("href")).toBe("/inscription");

    const catalogLink = screen.getByText("heroInfo.ctaViewCatalog").closest("a");
    expect(catalogLink?.getAttribute("href")).toBe("/produits");
  });

  it("utilisateur connecté : CTA principal bascule sur « Mon espace pro » → /espace-pro", () => {
    mockUseSession.mockReturnValueOnce({
      data: { user: { id: "u1", email: "c@x.fr", role: "CLIENT" } },
      status: "authenticated",
    } as ReturnType<typeof mockUseSession>);
    render(<HeroInfoFaq {...baseProps} />);

    // Le libellé « Ouvrir un compte pro » ne doit PLUS apparaître.
    expect(screen.queryByText("heroInfo.ctaOpenAccount")).toBeNull();

    const accountLink = screen.getByText("heroInfo.ctaMyAccount").closest("a");
    expect(accountLink?.getAttribute("href")).toBe("/espace-pro");
  });

  it("FAQ : la 1re question est ouverte par défaut, le clic bascule sur la 2e", () => {
    render(<HeroInfoFaq {...baseProps} />);

    // 1re question ouverte : aria-expanded=true
    const q1 = screen.getByRole("button", { name: "Question 1 ?" });
    expect(q1.getAttribute("aria-expanded")).toBe("true");

    const q2 = screen.getByRole("button", { name: "Question 2 ?" });
    expect(q2.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(q2);
    expect(q1.getAttribute("aria-expanded")).toBe("false");
    expect(q2.getAttribute("aria-expanded")).toBe("true");

    // Un 2e clic sur la même question la referme
    fireEvent.click(q2);
    expect(q2.getAttribute("aria-expanded")).toBe("false");
  });

  it("FAQ vide : rien ne casse, placeholder discret rendu", () => {
    render(<HeroInfoFaq {...baseProps} faqItems={[]} />);

    // Aucun bouton FAQ
    expect(screen.queryByRole("button", { name: /\?/ })).toBeNull();
    // Le placeholder « — » est présent
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("CTA contact FAQ : Chat → /nous-contacter, Téléphone → tel:, WhatsApp → wa.me (fallback sur téléphone)", () => {
    render(<HeroInfoFaq {...baseProps} />);

    const chatLink = screen.getByText("faqHero.contactChat").closest("a");
    expect(chatLink?.getAttribute("href")).toBe("/nous-contacter");

    // Téléphone : espace + accents retirés, préfixe tel:
    const phoneLink = screen.getByText("faqHero.contactPhone").closest("a");
    expect(phoneLink?.getAttribute("href")).toBe("tel:+33123456789");

    // WhatsApp : espaces + « + » retirés, préfixe wa.me
    const waLink = screen.getByText("faqHero.contactWhatsapp").closest("a");
    expect(waLink?.getAttribute("href")).toBe("https://wa.me/33123456789");
    // Ouvre dans un nouvel onglet, sans référent
    expect(waLink?.getAttribute("target")).toBe("_blank");
    expect(waLink?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("téléphone / WhatsApp masqués si aucun numéro configuré (Chat reste visible)", () => {
    render(
      <HeroInfoFaq {...baseProps} companyPhone={null} companyWhatsapp={null} />
    );

    // Chat toujours présent (page contact = fallback universel)
    expect(screen.getByText("faqHero.contactChat")).toBeInTheDocument();
    // Téléphone + WhatsApp absents
    expect(screen.queryByText("faqHero.contactPhone")).toBeNull();
    expect(screen.queryByText("faqHero.contactWhatsapp")).toBeNull();
  });
});
