import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ColorSwatch } from "@/components/admin/products/AdminProductsTable";

describe("ColorSwatch", () => {
  afterEach(() => cleanup());

  it("expose le nom de la couleur en aria-label pour l'accessibilité", () => {
    render(<ColorSwatch color={{ name: "Doré", hex: "#D4AF37", patternImage: null }} />);
    const el = screen.getByLabelText("Doré");
    expect(el).toBeInTheDocument();
  });

  it("utilise le hex en background quand aucun patternImage", () => {
    render(<ColorSwatch color={{ name: "Bleu", hex: "#1E40AF", patternImage: null }} />);
    const el = screen.getByLabelText("Bleu");
    expect(el.style.backgroundColor).toBe("rgb(30, 64, 175)");
    expect(el.style.backgroundImage).toBe("");
  });

  it("utilise patternImage en priorité sur hex quand fourni", () => {
    render(
      <ColorSwatch
        color={{ name: "Motif", hex: "#000000", patternImage: "/uploads/motif.jpg" }}
      />,
    );
    const el = screen.getByLabelText("Motif");
    expect(el.style.backgroundImage).toContain("/uploads/motif.jpg");
  });

  it("retombe sur un gris neutre quand hex et patternImage sont vides", () => {
    render(<ColorSwatch color={{ name: "Inconnu", hex: null, patternImage: null }} />);
    const el = screen.getByLabelText("Inconnu");
    expect(el.style.backgroundColor).toBe("rgb(156, 163, 175)");
  });

  it("affiche la légende flottante au survol avec le nom exact de la couleur", () => {
    render(<ColorSwatch color={{ name: "Or rose", hex: "#B76E79", patternImage: null }} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText("Or rose"));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Or rose");
  });

  it("masque la légende quand la souris quitte la pastille", () => {
    render(<ColorSwatch color={{ name: "Rouge", hex: "#DC143C", patternImage: null }} />);
    const el = screen.getByLabelText("Rouge");
    fireEvent.mouseEnter(el);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("affiche aussi la légende au focus clavier (accessibilité)", () => {
    render(<ColorSwatch color={{ name: "Vert", hex: "#059669", patternImage: null }} />);
    const el = screen.getByLabelText("Vert");
    fireEvent.focus(el);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Vert");
    fireEvent.blur(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
