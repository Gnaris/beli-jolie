import { render, screen, cleanup, within } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { VariantCardMobile } from "@/components/admin/products/AdminProductsTable";

/**
 * La modale « Modifier les variantes » (menu ⋮ en mobile) affichait un tableau
 * à 7 colonnes qui débordait horizontalement. On l'a remplacé par une carte
 * verticale par variante avec grille 2×2 pour les métriques éditables.
 * Ces tests couvrent l'affichage carte : contenu, absence de tableau, dirty
 * flag, et gestion PACK / UNIT.
 */

// Variantes de test minimales — respecte l'interface ColorVariant du composant.
const baseVariant = {
  id: "v1",
  colorId: "c1",
  unitPrice: 4.2,
  weight: 0.08,
  stock: 3,
  isPrimary: false,
  disabled: false,
  saleType: "UNIT" as const,
  packQuantity: null,
  variantSizes: [{ size: { name: "TU" }, quantity: 1 } as never],
  color: { name: "Bleu marine", hex: "#1E40AF", patternImage: null },
};

describe("VariantCardMobile — carte verticale pour la modale mobile", () => {
  afterEach(() => cleanup());

  it("n'utilise AUCUN élément <table> (fini le scroll horizontal)", () => {
    const { container } = render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("thead")).toBeNull();
    expect(container.querySelector("tr")).toBeNull();
    expect(container.querySelector("td")).toBeNull();
  });

  it("affiche le nom de la couleur, le prix, le stock et le poids sur une seule carte", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText("Bleu marine")).toBeInTheDocument();
    expect(screen.getByText(/4,20\s*€/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/0,08\s*kg/)).toBeInTheDocument();
  });

  it("affiche les 4 étiquettes de la grille métriques (Prix HT / Stock / Prix HT total / Poids)", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText("Prix HT")).toBeInTheDocument();
    expect(screen.getByText("Prix HT total")).toBeInTheDocument();
    expect(screen.getByText("Stock")).toBeInTheDocument();
    expect(screen.getByText("Poids")).toBeInTheDocument();
  });

  it("montre « — » à la place du Prix HT total pour une variante UNIT", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Unité")).toBeInTheDocument();
  });

  it("expose la quantité par pack éditable et le prix total calculé pour une variante PACK", () => {
    const packVariant = {
      ...baseVariant,
      id: "v-pack",
      saleType: "PACK" as const,
      packQuantity: 12,
      // Pas de variantSizes : computeVariantPackTotalQty retombe sur packQuantity.
      variantSizes: undefined,
      unitPrice: 42, // total BDD = 12 × 3,50
    };
    const { container } = render(
      <VariantCardMobile
        variant={packVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    // Prix HT unitaire = 42 / 12 = 3,50 € — les text nodes sont éclatés
    // (« 3,50 » puis « €ˣ ») donc on cherche par contenu de nœud.
    const text = container.textContent ?? "";
    expect(text).toMatch(/3,50\s*€/);
    // Prix HT total = 42,00 €
    expect(text).toMatch(/42,00\s*€/);
    // Badge Pack × 12
    expect(screen.getByText(/Pack/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("permet de basculer activée/désactivée en appelant onCommitCell", () => {
    const onCommit = vi.fn();
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={onCommit}
      />,
    );
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveTextContent("Activée");
    toggle.click();
    expect(onCommit).toHaveBeenCalledWith("v1", "disabled", true, false);
  });

  it("marque le fond rouge quand stock = 0", () => {
    const { container } = render(
      <VariantCardMobile
        variant={{ ...baseVariant, stock: 0 }}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    const card = container.querySelector(".variant-card-mobile");
    expect(card?.className).toContain("bg-red-50/60");
  });

  it("marque le fond rouge quand la variante est désactivée", () => {
    const { container } = render(
      <VariantCardMobile
        variant={{ ...baseVariant, disabled: true }}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    const card = container.querySelector(".variant-card-mobile");
    expect(card?.className).toContain("bg-red-50/60");
  });

  it("prend en compte les édits en attente (dirty) — le prix affiché reflète l'edit courant", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{ price: 9.99 }}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText(/9,99\s*€/)).toBeInTheDocument();
  });

  it("affiche les tailles multiples en badge quand la variante a plusieurs VariantSize", () => {
    render(
      <VariantCardMobile
        variant={{
          ...baseVariant,
          variantSizes: [
            { size: { name: "S" }, quantity: 1 } as never,
            { size: { name: "M" }, quantity: 1 } as never,
            { size: { name: "L" }, quantity: 1 } as never,
          ],
        }}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText("S, M, L")).toBeInTheDocument();
  });

  it("utilise patternImage en priorité sur hex pour le rond de couleur", () => {
    const { container } = render(
      <VariantCardMobile
        variant={{
          ...baseVariant,
          color: { name: "Motif", hex: "#000", patternImage: "/uploads/motif.jpg" },
        }}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    const swatch = container.querySelector("[title='Motif']") as HTMLElement | null;
    expect(swatch).not.toBeNull();
    expect(swatch!.style.backgroundImage).toContain("/uploads/motif.jpg");
  });

  it("contient bien une grille 2 colonnes avec les 4 étiquettes métriques", () => {
    const { container } = render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    const grid = container.querySelector(".grid.grid-cols-2");
    expect(grid).not.toBeNull();
    const cells = within(grid as HTMLElement).getAllByText(/Prix HT|Stock|Poids/);
    expect(cells.length).toBeGreaterThanOrEqual(4);
  });

  it("affiche un sous-titre « Vendue à l'unité » pour un UNIT", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText("Vendue à l'unité")).toBeInTheDocument();
  });

  it("affiche le sous-titre « Variante ×N par paquet » pour un PACK", () => {
    render(
      <VariantCardMobile
        variant={{
          ...baseVariant,
          saleType: "PACK",
          packQuantity: 12,
          variantSizes: undefined,
        }}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.getByText(/Variante ×12 par paquet/)).toBeInTheDocument();
  });

  it("n'affiche pas le badge « Couleur principale » quand isPrimaryColor est absent (défaut false)", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
      />,
    );
    expect(screen.queryByText("Couleur principale")).toBeNull();
  });

  it("n'affiche pas le badge « Couleur principale » quand isPrimaryColor=false", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
        isPrimaryColor={false}
      />,
    );
    expect(screen.queryByText("Couleur principale")).toBeNull();
  });

  it("affiche le badge noir « Couleur principale » quand isPrimaryColor=true", () => {
    render(
      <VariantCardMobile
        variant={baseVariant}
        editsForVariant={{}}
        onCommitCell={() => {}}
        isPrimaryColor
      />,
    );
    const badge = screen.getByText("Couleur principale");
    expect(badge).toBeInTheDocument();
    // Fond noir + texte blanc — vérif rapide via classes utilitaires
    expect(badge.className).toContain("bg-black");
    expect(badge.className).toContain("text-white");
  });
});
