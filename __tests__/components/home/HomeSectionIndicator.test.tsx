/**
 * HomeSectionIndicator — indicateur flottant à gauche de la home BJ.
 * Vérifie que :
 *  - Rien ne s'affiche si la liste de sections est vide.
 *  - Au rendu initial, la première section est affichée en principal et la
 *    seconde en secondaire (basse opacité).
 *  - Quand on scrolle et que la section 2 passe au-dessus de la ligne
 *    d'ancrage (35 % du viewport), l'indicateur bascule sur la section 2 en
 *    principal, avec la section 3 en secondaire.
 *  - Quand on atteint la dernière section, il n'y a plus de « suivante »
 *    affichée.
 *  - Le compteur pagination (« 02 / 04 ») suit l'index actif.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import HomeSectionIndicator from "@/components/home/HomeSectionIndicator";

const SECTIONS = [
  { id: "sec-1", label: "Accueil" },
  { id: "sec-2", label: "Nouveautés" },
  { id: "sec-3", label: "Catégories" },
  { id: "sec-4", label: "Showroom" },
];

// Chaque test contrôle où se trouve chaque section dans le viewport en
// écrasant getBoundingClientRect. La ligne d'ancrage du composant est à
// 35 % de la hauteur du viewport (soit 280 px pour un viewport de 800 px).
// Les fakes sont montées dans un wrapper dédié (pas dans document.body
// directement) pour ne pas être supprimées quand @testing-library démonte
// le composant React entre chaque test.
let sectionsWrapper: HTMLElement | null = null;

function mountSections(topsPx: number[]) {
  if (!sectionsWrapper) {
    sectionsWrapper = document.createElement("div");
    document.body.appendChild(sectionsWrapper);
    SECTIONS.forEach((s) => {
      const el = document.createElement("div");
      el.id = s.id;
      sectionsWrapper!.appendChild(el);
    });
  }
  SECTIONS.forEach((s, i) => {
    const el = document.getElementById(s.id)!;
    el.getBoundingClientRect = () =>
      ({ top: topsPx[i], bottom: topsPx[i] + 500, left: 0, right: 0, height: 500, width: 0, x: 0, y: topsPx[i], toJSON: () => ({}) }) as DOMRect;
  });
}

describe("HomeSectionIndicator", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  afterEach(() => {
    if (sectionsWrapper) {
      sectionsWrapper.remove();
      sectionsWrapper = null;
    }
  });

  it("ne rend rien si la liste de sections est vide", () => {
    const { container } = render(<HomeSectionIndicator sections={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("affiche la 1ʳᵉ section en principal et la 2ᵉ en suivante au premier rendu", () => {
    // Section 1 au-dessus de l'ancrage (top=0 ≤ 280), donc active.
    mountSections([0, 900, 1800, 2700]);
    render(<HomeSectionIndicator sections={SECTIONS} />);
    expect(screen.getByText("Accueil")).toBeInTheDocument();
    expect(screen.getByText("Nouveautés")).toBeInTheDocument();
    expect(screen.getByText("01 / 04")).toBeInTheDocument();
  });

  it("bascule sur la section 2 quand elle passe au-dessus de la ligne d'ancrage", () => {
    mountSections([0, 900, 1800, 2700]);
    render(<HomeSectionIndicator sections={SECTIONS} />);

    // Simule un scroll : la section 2 est maintenant à 100 px du top (< 280).
    mountSections([-800, 100, 1000, 1900]);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByText("Nouveautés")).toBeInTheDocument();
    expect(screen.getByText("Catégories")).toBeInTheDocument();
    expect(screen.getByText("02 / 04")).toBeInTheDocument();
  });

  it("n'affiche plus de section suivante quand on atteint la dernière", () => {
    mountSections([-2700, -1800, -900, 100]);
    render(<HomeSectionIndicator sections={SECTIONS} />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByText("Showroom")).toBeInTheDocument();
    expect(screen.getByText("04 / 04")).toBeInTheDocument();
    // Il ne reste plus qu'un item dans la stack (la section active) — les
    // labels des sections précédentes ne sont pas rendus.
    expect(screen.queryByText("Catégories")).toBeNull();
  });

  it("bascule en palette blanche quand la section active a tone=\"dark\"", () => {
    const darkSections: typeof SECTIONS[number][] & { [n: number]: { id: string; label: string; tone?: "light" | "dark" } } = [
      { id: "sec-1", label: "Accueil" },
      { id: "sec-2", label: "Avis", tone: "dark" },
      { id: "sec-3", label: "Rejoindre", tone: "dark" },
    ] as never;
    mountSections([0, 900, 1800, 2700]);
    // On aligne artificiellement l'ID de la section 2 sur le fake DOM.
    document.getElementById("sec-2")!.getBoundingClientRect = () =>
      ({ top: 100, bottom: 600, left: 0, right: 0, height: 500, width: 0, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.getElementById("sec-1")!.getBoundingClientRect = () =>
      ({ top: -800, bottom: -300, left: 0, right: 0, height: 500, width: 0, x: 0, y: -800, toJSON: () => ({}) }) as DOMRect;

    render(<HomeSectionIndicator sections={darkSections} />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    // La section « Avis » est active, tone dark → le label courant doit
    // porter la classe text-white (palette dark). On teste via className
    // plutôt que le style calculé (jsdom ne calcule pas les couleurs).
    const currentLabel = screen.getByText("Avis");
    expect(currentLabel.className).toContain("text-white");
    expect(currentLabel.className).not.toContain("text-slate-900");
  });
});
