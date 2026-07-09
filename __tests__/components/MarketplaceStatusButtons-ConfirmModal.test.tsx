import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmModal } from "@/components/admin/products/MarketplaceStatusButtons";

// Nouvelle modale de synchronisation marketplace (design cockpit).
// On vérifie que le contenu correspond au mode (resync = checklist,
// publish = paragraphe), que la couleur du marketplace est bien portée,
// et que les interactions (Annuler / clic backdrop / Esc / confirmer)
// appellent les bons handlers.

describe("MarketplaceStatusButtons — ConfirmModal", () => {
  const baseProps = {
    productName: "Bague fine acier doré cœur émaillé",
    reference: "A2521E-1200",
    firstImage: "/uploads/produits/a2521e-1.webp",
    infoNote: "La fiche existante est gardée telle quelle.",
    confirmLabel: "Envoyer maintenant",
    onCancel: () => {},
    onConfirm: () => {},
  } as const;

  it("mode resync : affiche la checklist « Ce qui sera renvoyé »", () => {
    render(
      <ConfirmModal
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

  it("mode publish : affiche le paragraphe et le sous-titre « première publication »", () => {
    render(
      <ConfirmModal
        {...baseProps}
        marketplace="ankorstore"
        mode="publish"
        title="Publier ce produit sur Ankorstore ?"
        message="Ce produit n'existe pas encore sur Ankorstore."
      />,
    );
    expect(screen.getByText(/n'existe pas encore/i)).toBeInTheDocument();
    expect(screen.getByText(/première publication/i)).toBeInTheDocument();
    // pas de checklist en mode publish
    expect(screen.queryByText(/Ce qui sera renvoyé/i)).not.toBeInTheDocument();
  });

  it("porte la couleur du marketplace (indigo pour PFS, sky pour Ankorstore)", () => {
    const { rerender, container } = render(
      <ConfirmModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="Renvoyer PFS"
        items={["Prix"]}
      />,
    );
    // eyebrow pastille + label sont bien en couleur PFS (indigo)
    expect(container.innerHTML).toMatch(/text-indigo-700/);
    expect(container.innerHTML).toMatch(/bg-indigo-500/);

    rerender(
      <ConfirmModal
        {...baseProps}
        marketplace="ankorstore"
        mode="resync"
        title="Renvoyer Ankorstore"
        items={["Prix"]}
      />,
    );
    expect(container.innerHTML).toMatch(/text-sky-700/);
    expect(container.innerHTML).toMatch(/bg-sky-500/);
  });

  it("affiche la vignette produit si firstImage est fourni", () => {
    const { container } = render(
      <ConfirmModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/uploads/produits/a2521e-1.webp");
  });

  it("clic sur « Annuler » appelle onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Annuler/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clic sur le bouton principal appelle onConfirm (pas onCancel)", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        {...baseProps}
        marketplace="faire"
        mode="resync"
        title="X"
        items={["Prix"]}
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmLabel="Envoyer maintenant"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Envoyer maintenant/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("touche Escape ferme la modale", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        {...baseProps}
        marketplace="pfs"
        mode="resync"
        title="X"
        items={["Prix"]}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
