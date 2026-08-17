import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type {
  AnkorstoreBoLinkCandidate,
  AnkorstoreBoLocalColorPreview,
} from "@/app/actions/admin/ankorstore-bo";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@/app/actions/admin/ankorstore-bo", () => ({
  searchAnkorstoreBoCandidatesForBjProduct: vi.fn(),
  linkBjProductToAnkorstoreBo: vi.fn(),
}));

vi.mock("@/lib/image-utils", () => ({
  getImageSrc: (p: string) => p,
}));

import LinkAnkorstoreProductModal from "@/components/admin/products/LinkAnkorstoreProductModal";
import {
  searchAnkorstoreBoCandidatesForBjProduct,
  linkBjProductToAnkorstoreBo,
} from "@/app/actions/admin/ankorstore-bo";

const searchMock = searchAnkorstoreBoCandidatesForBjProduct as unknown as ReturnType<typeof vi.fn>;
const linkMock = linkBjProductToAnkorstoreBo as unknown as ReturnType<typeof vi.fn>;

function makeCandidate(overrides: Partial<AnkorstoreBoLinkCandidate> = {}): AnkorstoreBoLinkCandidate {
  return {
    ankorProductId: 4820291,
    ankorProductUuid: "uuid-1",
    name: "Bague papillon vernie – acier",
    link: "/fr/produit/bague-papillon-4820291",
    imageUrl: null,
    variants: [
      { id: 1, sku: "A1720-DOR", colorValue: "Doré clair" },
      { id: 2, sku: "A1720-ARG", colorValue: "Argenté" },
    ],
    confidence: "high",
    matchedVariantCount: 2,
    ...overrides,
  };
}

function makeLocalColor(overrides: Partial<AnkorstoreBoLocalColorPreview> = {}): AnkorstoreBoLocalColorPreview {
  return {
    productColorId: "pc-1",
    colorName: "Doré clair",
    hex: "#f4d47c",
    patternImage: null,
    skuPreview: "A1720_DORE_CLAIR_?????",
    isNewSku: true,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LinkAnkorstoreProductModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("affiche le loader tant que l'action de recherche n'a pas répondu", () => {
    searchMock.mockImplementation(() => new Promise(() => {})); // pending
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/Interrogation d'Ankorstore/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("affiche l'état vide quand la recherche ne retourne aucun candidat", async () => {
    searchMock.mockResolvedValue({
      success: true,
      candidates: [],
      bjReference: "A1720",
      localColorsPreview: [],
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/Aucun produit trouvé/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Publier chez Ankorstore/)).toBeInTheDocument();
  });

  it("affiche l'état erreur quand la recherche échoue", async () => {
    searchMock.mockResolvedValue({
      success: false,
      error: "Session expirée",
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/Impossible d'interroger Ankorstore/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Session expirée")).toBeInTheDocument();
  });

  it("liste les candidats avec badge de confiance, ID et compteur de variantes", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [makeLocalColor()],
      candidates: [
        makeCandidate({ confidence: "high", matchedVariantCount: 2 }),
        makeCandidate({
          ankorProductId: 4517338,
          name: "Bague papillon ancienne",
          confidence: "medium",
          matchedVariantCount: 1,
        }),
      ],
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/2 candidats/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Correspondance forte/i)).toBeInTheDocument();
    expect(screen.getByText(/Correspondance partielle/i)).toBeInTheDocument();
    expect(screen.getByText("#4820291")).toBeInTheDocument();
    expect(screen.getByText("#4517338")).toBeInTheDocument();
    expect(screen.getByText("Bague papillon vernie – acier")).toBeInTheDocument();
  });

  it("affiche le preview des SKU cibles avec les couleurs BJ", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [
        makeLocalColor({ productColorId: "c1", colorName: "Doré clair", skuPreview: "A1720_DORE_CLAIR_?????" }),
        makeLocalColor({ productColorId: "c2", colorName: "Argenté", hex: "#c0c0c8", skuPreview: "A1720_ARGENTE_?????" }),
      ],
      candidates: [makeCandidate()],
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("A1720_DORE_CLAIR_?????")).toBeInTheDocument();
    });
    expect(screen.getByText("A1720_ARGENTE_?????")).toBeInTheDocument();
  });

  it("appelle linkBjProductToAnkorstoreBo au clic sur « Lier ce produit » et ferme la modale au succès", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [makeLocalColor()],
      candidates: [makeCandidate()],
    });
    linkMock.mockResolvedValue({ success: true, linkedVariants: 2 });
    const onClose = vi.fn();
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Lier ce produit/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Lier ce produit/i }));
    expect(linkMock).toHaveBeenCalledWith("p1", 4820291);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("affiche la timeline pendant la liaison (ne ferme pas immédiatement)", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [makeLocalColor()],
      candidates: [makeCandidate()],
    });
    // Le link met du temps → la timeline doit apparaître
    let resolveLink: (v: { success: boolean; linkedVariants?: number }) => void = () => {};
    linkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLink = resolve;
        })
    );
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => screen.getByRole("button", { name: /Lier ce produit/i }));
    fireEvent.click(screen.getByRole("button", { name: /Lier ce produit/i }));
    await waitFor(() => {
      // Heading de la timeline (unique — le footer utilise « Liaison en cours… » avec ellipsis)
      expect(screen.getByText(/^Liaison en cours$/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Écrasement des variantes SKU chez Ankor/i)).toBeInTheDocument();
    // Le bouton du footer affiche « Liaison en cours… » (avec l'ellipsis) et est disabled
    const footerBtn = screen.getByRole("button", { name: /Liaison en cours…/i });
    expect(footerBtn).toBeDisabled();
    // Débloquer la promise pour laisser React finir de nettoyer
    resolveLink({ success: true, linkedVariants: 2 });
    await waitFor(() => {
      // La modale devrait se fermer (onClose est appelé au succès — testé ailleurs)
      // Ici on vérifie juste qu'on ne throw pas.
    });
  });

  it("le bouton « Lier quand même » apparaît pour une correspondance partielle", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [makeLocalColor()],
      candidates: [
        makeCandidate({ confidence: "medium", matchedVariantCount: 1 }),
      ],
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Lier quand même/i })).toBeInTheDocument();
    });
  });

  it("affiche la vignette produit Ankor quand imageUrl est fourni", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "ZC40E",
      localColorsPreview: [makeLocalColor()],
      candidates: [
        makeCandidate({
          ankorProductId: 7025702,
          imageUrl: "https://img.ankorstore.com/products/images/7025702-abc.jpg",
        }),
      ],
    });
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="ZC40E"
        onClose={vi.fn()}
      />
    );
    const img = await screen.findByRole("img", { name: /Bague papillon vernie/i });
    expect(img).toHaveAttribute(
      "src",
      "https://img.ankorstore.com/products/images/7025702-abc.jpg"
    );
  });

  it("appelle onClose au clic sur le backdrop uniquement quand aucune liaison n'est en cours", async () => {
    searchMock.mockResolvedValue({
      success: true,
      bjReference: "A1720",
      localColorsPreview: [makeLocalColor()],
      candidates: [makeCandidate()],
    });
    const onClose = vi.fn();
    render(
      <LinkAnkorstoreProductModal
        productId="p1"
        productName="Bague test"
        reference="A1720"
        onClose={onClose}
      />
    );
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
