import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarketplacePushModal } from "@/components/admin/products/MarketplacePushModal";

// La modale de confirmation (publish / resync) est maintenant portée par
// MarketplacePushModal (unification 2026-07-17 — remplace l'ancien
// ConfirmModal interne de MarketplaceStatusButtons). Palette ardoise, seule
// l'initiale garde le gradient de marque du marketplace.

describe("MarketplacePushModal — publish / resync", () => {
  const baseProps = {
    open: true,
    productName: "Bague fine acier doré cœur émaillé",
    productReference: "A2521E-1200",
    productImage: "/uploads/produits/a2521e-1.webp",
    infoMessage: "La fiche existante est gardée telle quelle.",
    confirmLabel: "Envoyer maintenant",
    onClose: () => {},
    onConfirm: () => {},
  } as const;

  it("mode resync : affiche la checklist « Ce qui sera renvoyé »", () => {
    render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="Renvoyer les infos à Paris Fashion Shop ?"
        items={["Nom & description", "Photos", "Prix"]}
      />,
    );
    expect(screen.getByText(/Ce qui sera renvoyé/i)).toBeInTheDocument();
    expect(screen.getByText("Nom & description")).toBeInTheDocument();
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.getByText("Prix")).toBeInTheDocument();
  });

  it("mode publish : affiche le paragraphe libre + subtitle « première publication »", () => {
    render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="ankorstore"
        mode="publish"
        subtitle="première publication"
        title="Publier ce produit sur Ankorstore ?"
        message="Ce produit n'existe pas encore sur Ankorstore."
      />,
    );
    expect(screen.getByText(/n'existe pas encore/i)).toBeInTheDocument();
    expect(screen.getByText(/première publication/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ce qui sera renvoyé/i)).not.toBeInTheDocument();
  });

  it("porte le gradient figé de l'initiale marketplace (indigo pour PFS, sky pour Ankorstore)", () => {
    const { rerender, unmount } = render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="Renvoyer PFS"
        items={["Prix"]}
      />,
    );
    // La modale est rendue via createPortal dans document.body. JSDOM
    // normalise les couleurs hex en rgb() — on vérifie les 2 formes.
    expect(document.body.innerHTML).toMatch(/rgb\(79,\s*70,\s*229\)|#4f46e5/i);
    expect(document.body.innerHTML).toMatch(/rgb\(99,\s*102,\s*241\)|#6366f1/i);

    rerender(
      <MarketplacePushModal
        {...baseProps}
        marketplace="ankorstore"
        mode="resync"
        title="Renvoyer Ankorstore"
        items={["Prix"]}
      />,
    );
    expect(document.body.innerHTML).toMatch(/rgb\(14,\s*165,\s*233\)|#0ea5e9/i);
    expect(document.body.innerHTML).toMatch(/rgb\(56,\s*189,\s*248\)|#38bdf8/i);
    unmount();
  });

  it("affiche la vignette produit si productImage est fourni", () => {
    const { unmount } = render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
      />,
    );
    const img = document.body.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/uploads/produits/a2521e-1.webp");
    unmount();
  });

  it("clic sur « Annuler » appelle onClose", () => {
    const onClose = vi.fn();
    render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Annuler/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clic sur le bouton principal appelle onConfirm (pas onClose)", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="faire"
        mode="resync"
        title="X"
        items={["Prix"]}
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel="Envoyer maintenant"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Envoyer maintenant/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("touche Escape ferme la modale", () => {
    const onClose = vi.fn();
    render(
      <MarketplacePushModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
