import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ZoomableImage } from "@/components/admin/products/ZoomableImage";

/**
 * Garde-fou mobile : même défaut potentiel que OrderItemImage. Dans la modale
 * de liaison marketplace, le pinch-zoom sur une variante ne doit pas déclencher
 * le téléchargement natif du navigateur.
 */

vi.mock("@/lib/image-utils", () => ({
  getImageSrc: (src: string) => src,
}));

describe("ZoomableImage — lightbox mobile", () => {
  function openLightbox() {
    render(<ZoomableImage src="/uploads/produits/exemple.webp" alt="Exemple" />);
    fireEvent.click(screen.getByLabelText("Voir l'image en grand"));
    // 2 images rendues : miniature + agrandie dans la modale.
    // Celle de la modale a la classe "max-h-[90vh]".
    const imgs = screen.getAllByAltText("Exemple") as HTMLImageElement[];
    const lightboxImg = imgs.find((i) => i.className.includes("max-h-[90vh]"));
    if (!lightboxImg) throw new Error("Image lightbox introuvable");
    return lightboxImg;
  }

  it("désactive le drag natif", () => {
    const img = openLightbox();
    expect(img.draggable).toBe(false);
  });

  it("bloque le menu contextuel long-press", () => {
    const img = openLightbox();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const prevented = !img.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("désactive la sélection (callout iOS inline)", () => {
    const img = openLightbox();
    expect(img.style.userSelect).toBe("none");
    expect(img.className).toContain("select-none");
  });
});
