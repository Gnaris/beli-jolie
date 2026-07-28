import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { ColorSwatch, isColorOutOfStock, isColorAllDisabled } from "@/components/admin/products/AdminProductsTable";

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

  it("entoure la pastille en rouge et enrichit l'aria-label quand outOfStock=true", () => {
    render(
      <ColorSwatch
        color={{ name: "Argent", hex: "#C0C0C0", patternImage: null }}
        outOfStock
      />,
    );
    const el = screen.getByLabelText("Argent — rupture de stock");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-out-of-stock")).toBe("true");
    // La couleur rouge (#DC2626) doit apparaître dans le boxShadow d'entourage.
    expect(el.className).toContain("shadow-[0_0_0_2px_#DC2626]");
  });

  it("laisse l'aria-label neutre quand outOfStock est absent ou faux", () => {
    render(<ColorSwatch color={{ name: "Cuivre", hex: "#B87333", patternImage: null }} />);
    const el = screen.getByLabelText("Cuivre");
    expect(el.hasAttribute("data-out-of-stock")).toBe(false);
  });

  it("entoure la pastille en rouge et enrichit l'aria-label quand allDisabled=true", () => {
    render(
      <ColorSwatch
        color={{ name: "Bronze", hex: "#CD7F32", patternImage: null }}
        allDisabled
      />,
    );
    const el = screen.getByLabelText("Bronze — variantes désactivées");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-all-disabled")).toBe("true");
    expect(el.className).toContain("shadow-[0_0_0_2px_#DC2626]");
  });

  it("privilégie le libellé « désactivées » quand outOfStock et allDisabled sont simultanément vrais", () => {
    render(
      <ColorSwatch
        color={{ name: "Nickel", hex: "#727472", patternImage: null }}
        outOfStock
        allDisabled
      />,
    );
    expect(screen.getByLabelText("Nickel — variantes désactivées")).toBeInTheDocument();
  });
});

describe("isColorOutOfStock", () => {
  it("renvoie true quand toutes les variantes partageant le colorId sont à 0", () => {
    const colors = [
      { colorId: "c1", stock: 0 },
      { colorId: "c1", stock: 0 },
      { colorId: "c2", stock: 3 },
    ];
    expect(isColorOutOfStock(colors, "c1")).toBe(true);
  });

  it("renvoie false dès qu'au moins une variante de la couleur a du stock", () => {
    const colors = [
      { colorId: "c1", stock: 0 },
      { colorId: "c1", stock: 2 },
    ];
    expect(isColorOutOfStock(colors, "c1")).toBe(false);
  });

  it("renvoie false quand aucune variante ne matche le colorId (couleur orpheline)", () => {
    const colors = [{ colorId: "c1", stock: 0 }];
    expect(isColorOutOfStock(colors, "c2")).toBe(false);
  });

  it("renvoie false pour un colorId null (variante legacy sans couleur)", () => {
    expect(isColorOutOfStock([{ colorId: null, stock: 0 }], null)).toBe(false);
  });
});

describe("isColorAllDisabled", () => {
  it("renvoie true quand toutes les variantes partageant le colorId sont désactivées", () => {
    const colors = [
      { colorId: "c1", disabled: true },
      { colorId: "c1", disabled: true },
      { colorId: "c2", disabled: false },
    ];
    expect(isColorAllDisabled(colors, "c1")).toBe(true);
  });

  it("renvoie false dès qu'au moins une variante de la couleur est activée", () => {
    const colors = [
      { colorId: "c1", disabled: true },
      { colorId: "c1", disabled: false },
    ];
    expect(isColorAllDisabled(colors, "c1")).toBe(false);
  });

  it("renvoie false quand aucune variante ne matche le colorId", () => {
    const colors = [{ colorId: "c1", disabled: true }];
    expect(isColorAllDisabled(colors, "c2")).toBe(false);
  });

  it("renvoie false pour un colorId null", () => {
    expect(isColorAllDisabled([{ colorId: null, disabled: true }], null)).toBe(false);
  });
});
