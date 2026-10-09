import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import OrderItemImage from "@/components/ui/OrderItemImage";

/**
 * Garde-fou mobile : dans le lightbox, le pinch-zoom ne doit jamais déclencher
 * un téléchargement/menu natif « Enregistrer l'image » qui remplace la page
 * par le fichier téléchargé (cf. incident 2026-10-09 depuis /admin/commandes/[id]).
 */
describe("OrderItemImage — lightbox mobile", () => {
  function openLightbox() {
    render(<OrderItemImage src="/uploads/produits/exemple.webp" alt="Exemple" />);
    // Premier bouton = la miniature cliquable. Après l'ouverture, un second
    // bouton (× close) apparaît.
    fireEvent.click(screen.getAllByRole("button")[0]);
    const imgs = screen.getAllByAltText("Exemple") as HTMLImageElement[];
    const lightboxImg = imgs.find((i) => i.className.includes("max-h-[100dvh]"));
    if (!lightboxImg) throw new Error("Image lightbox introuvable");
    return lightboxImg;
  }

  it("ouvre l'image agrandie au clic sur la miniature", () => {
    const img = openLightbox();
    expect(img.getAttribute("src")).toBe("/uploads/produits/exemple.webp");
  });

  it("désactive le drag natif (Windows → Downloads)", () => {
    const img = openLightbox();
    expect(img.draggable).toBe(false);
  });

  it("bloque le menu contextuel « Enregistrer l'image » (long-press mobile)", () => {
    const img = openLightbox();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const prevented = !img.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("désactive la sélection (callout iOS appliqué via style inline)", () => {
    const img = openLightbox();
    expect(img.style.userSelect).toBe("none");
    expect(img.className).toContain("select-none");
  });

  it("ne ferme pas le lightbox quand on clique sur l'image elle-même", () => {
    const img = openLightbox();
    fireEvent.click(img);
    const stillOpen = screen
      .getAllByAltText("Exemple")
      .some((i) => i.className.includes("max-h-[100dvh]"));
    expect(stillOpen).toBe(true);
  });
});
