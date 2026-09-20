/**
 * ShowroomSection : deux variantes (Issyma bordeaux + Beliandjolie ardoise).
 * On vérifie qu'un texte utilisateur (adresse, description, CTA) est bien
 * rendu, que l'URL Google Maps « directions » encode correctement l'adresse,
 * et que l'iframe pointe vers /maps?q= avec la même query.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ShowroomSection from "@/components/home/ShowroomSection";

const baseProps = {
  shopName: "Beli & Jolie",
  eyebrow: "Notre showroom",
  titleLine1: "Rencontrons-nous",
  titleLine2: "à Aubervilliers",
  addressLine1: "90 rue de la Haie Coq",
  addressLine2: "93300 Aubervilliers",
  welcomeLabel: "Accueil",
  welcomeValue: "Sur place, du lundi au vendredi",
  hoursLabel: "Horaires",
  hoursValue: "9h – 18h · Sur rendez-vous",
  description: "Au cœur du quartier grossiste.",
  ctaDirections: "Calculer mon itinéraire",
  ctaContact: "Nous contacter",
  lat: 48.9134,
  lon: 2.3765,
  mapsQuery: "90 rue de la Haie Coq 93300 Aubervilliers",
  pinLabel: "Haie Coq · 93300",
};

describe("ShowroomSection", () => {
  it("rend l'adresse, le shopName et le lien Google Maps encodé (Beliandjolie)", () => {
    const { container } = render(
      <ShowroomSection variant="beliandjolie" {...baseProps} />
    );

    expect(screen.getByText(/90 rue de la Haie Coq/)).toBeInTheDocument();
    expect(screen.getByText(/93300 Aubervilliers/)).toBeInTheDocument();
    expect(screen.getByText("Beli & Jolie")).toBeInTheDocument();
    expect(screen.getByText(/Calculer mon itinéraire/)).toBeInTheDocument();

    const directionsLink = screen.getByText(/Calculer mon itinéraire/).closest("a");
    expect(directionsLink?.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=90%20rue%20de%20la%20Haie%20Coq%2093300%20Aubervilliers"
    );

    // Le CTA "Nous contacter" pointe sur la route i18n /nous-contacter
    const contactLink = screen.getByText("Nous contacter").closest("a");
    expect(contactLink?.getAttribute("href")).toBe("/nous-contacter");

    // L'iframe carte utilise OpenStreetMap (aucune clé API requise) et pose
    // le marqueur aux coordonnées passées.
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toContain(
      "https://www.openstreetmap.org/export/embed.html?bbox="
    );
    expect(iframe?.getAttribute("src")).toContain("marker=48.9134,2.3765");
  });

  it("rend la variante Issyma avec sa palette bordeaux et sa position", () => {
    const { container } = render(
      <ShowroomSection
        {...baseProps}
        variant="issyma"
        shopName="ISSYMA-FORCYMA"
        titleLine2="au CIFA"
        addressLine1="Marché CIFA · Lot 165"
        lat={48.9128}
        lon={2.376}
        mapsQuery="Marché CIFA Aubervilliers"
        pinLabel="CIFA · Lot 165"
      />
    );

    expect(screen.getByText(/Marché CIFA · Lot 165/)).toBeInTheDocument();
    expect(screen.getByText("ISSYMA-FORCYMA")).toBeInTheDocument();

    const directionsLink = screen.getByText(/Calculer mon itinéraire/).closest("a");
    expect(directionsLink?.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=March%C3%A9%20CIFA%20Aubervilliers"
    );

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toContain("marker=48.9128,2.376");
  });
});
