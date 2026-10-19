import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Builder « Créer une commande admin » :
 * - 1 carte par produit avec pastilles couleurs (plus de ligne par variante).
 * - Clic sur une pastille → mini-modale qui affiche la photo DE LA COULEUR
 *   (pas celle du produit) + taille + quantité + Ajouter.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const searchMock = vi.fn();
const createMock = vi.fn();
vi.mock("@/app/actions/admin/create-admin-order", () => ({
  searchProductsForAdminOrder: (q: string) => searchMock(q),
  createAdminOrderForClient: (p: unknown) => createMock(p),
}));

import NouvelleCommandeAdmin from "@/components/admin/users/NouvelleCommandeAdmin";

const sampleProduct = {
  id: "p1",
  name: "Bague Luna",
  reference: "LUNA-01",
  imagePath: "produits/luna/or.webp",
  variants: [
    {
      id: "pc-or",
      colorName: "Or",
      colorHex: "#D4AF37",
      colorPatternImage: null,
      imagePath: "produits/luna/or.webp",
      stock: 8,
      unitPrice: 20,
      saleType: "UNIT" as const,
      packQuantity: null,
      sizes: [
        { id: "s52", name: "52", quantity: 3 },
        { id: "s54", name: "54", quantity: 5 },
      ],
    },
    {
      id: "pc-argent",
      colorName: "Argent",
      colorHex: "#C0C0C0",
      colorPatternImage: null,
      imagePath: "produits/luna/argent.webp",
      stock: 4,
      unitPrice: 20,
      saleType: "UNIT" as const,
      packQuantity: null,
      sizes: [{ id: "s52", name: "52", quantity: 4 }],
    },
  ],
};

async function typeAndWaitForResults() {
  const input = screen.getByPlaceholderText(/Nom ou référence du produit/i);
  fireEvent.change(input, { target: { value: "luna" } });
  await waitFor(() => expect(searchMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText("Bague Luna")).toBeInTheDocument());
}

describe("NouvelleCommandeAdmin — picker regroupé par produit", () => {
  afterEach(() => {
    cleanup();
    searchMock.mockReset();
    createMock.mockReset();
  });

  it("affiche 1 seule carte par produit avec une pastille par couleur", async () => {
    searchMock.mockResolvedValue({ success: true, results: [sampleProduct] });
    render(<NouvelleCommandeAdmin clientId="c1" clientLabel="Alice" clientDiscountPercent={0} />);
    await typeAndWaitForResults();

    // Carte unique produit (pas 2 lignes variante)
    expect(screen.getAllByText("Bague Luna")).toHaveLength(1);
    // 2 pastilles couleurs (tooltip title porte stock + prix)
    const orBtn = screen.getByRole("button", { name: "Or" });
    const argentBtn = screen.getByRole("button", { name: "Argent" });
    expect(orBtn).toBeInTheDocument();
    expect(argentBtn).toBeInTheDocument();
    expect(orBtn.getAttribute("title")).toContain("8 en stock");
    expect(argentBtn.getAttribute("title")).toContain("4 en stock");
  });

  it("ouvre la mini-modale au clic sur une pastille avec la photo DE LA COULEUR", async () => {
    searchMock.mockResolvedValue({ success: true, results: [sampleProduct] });
    render(<NouvelleCommandeAdmin clientId="c1" clientLabel="Alice" clientDiscountPercent={0} />);
    await typeAndWaitForResults();

    // Clic sur la pastille Argent → modale avec /uploads/produits/luna/argent.webp
    fireEvent.click(screen.getByRole("button", { name: /Argent/ }));
    const dialog = await screen.findByRole("dialog");
    const img = dialog.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/uploads/produits/luna/argent.webp");
  });

  it("affiche les tailles disponibles dans la modale et pré-sélectionne la 1ʳᵉ", async () => {
    searchMock.mockResolvedValue({ success: true, results: [sampleProduct] });
    render(<NouvelleCommandeAdmin clientId="c1" clientLabel="Alice" clientDiscountPercent={0} />);
    await typeAndWaitForResults();

    fireEvent.click(screen.getByRole("button", { name: /Or/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("52");
    expect(dialog).toHaveTextContent("54");
  });

  it("ajoute une ligne de commande au clic sur « Ajouter à la commande »", async () => {
    searchMock.mockResolvedValue({ success: true, results: [sampleProduct] });
    render(<NouvelleCommandeAdmin clientId="c1" clientLabel="Alice" clientDiscountPercent={0} />);
    await typeAndWaitForResults();

    fireEvent.click(screen.getByRole("button", { name: /Argent/ }));
    const confirm = await screen.findByRole("button", { name: /Ajouter à la commande/ });
    fireEvent.click(confirm);

    // La modale se ferme et la ligne apparaît (section « Articles de la commande »)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Articles de la commande/)).toBeInTheDocument();
    expect(screen.getByText(/LUNA-01/)).toBeInTheDocument();
  });

  it("désactive la pastille d'une couleur en rupture (stock=0)", async () => {
    const oos = {
      ...sampleProduct,
      variants: [
        { ...sampleProduct.variants[0], stock: 0, sizes: [] },
        sampleProduct.variants[1],
      ],
    };
    searchMock.mockResolvedValue({ success: true, results: [oos] });
    render(<NouvelleCommandeAdmin clientId="c1" clientLabel="Alice" clientDiscountPercent={0} />);
    await typeAndWaitForResults();

    const orBtn = screen.getByRole("button", { name: "Or" });
    expect(orBtn).toBeDisabled();
    expect(orBtn.getAttribute("title")).toContain("0 en stock");
  });
});
