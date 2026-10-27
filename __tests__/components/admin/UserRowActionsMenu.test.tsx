import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Menu « Actions » (⋮) sur /admin/clients, remplace l'ancien bouton « Voir ».
 * On vérifie que les 9 items demandés par la cliente apparaissent au clic,
 * et que les items grisés (RGPD mail / WhatsApp non vérifié) sont bien
 * désactivés avec le bon tooltip.
 */

// SendMailModal + DeleteUserConfirmModal embarquent server actions / useRouter /
// useLoadingOverlay / useToast : on les stub pour isoler le test au menu lui-même.
vi.mock("@/components/admin/users/SendMailModal", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/components/admin/users/DeleteUserConfirmModal", () => ({
  __esModule: true,
  default: ({ userName }: { userName: string }) => (
    <div data-testid="delete-modal">Modale suppression de {userName}</div>
  ),
}));

// useRouter() est appelé par UserRowActionsMenu pour le refresh post-suppression.
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  };
});

// Contextes de confirmation / toast + server action utilisés par l'item
// « Désactiver le client ». On isole le test au rendu du menu.
vi.mock("@/components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/app/actions/admin/updateUserStatus", () => ({
  updateUserStatus: vi.fn(async () => ({ success: true })),
}));

import UserRowActionsMenu from "@/components/admin/users/UserRowActionsMenu";

const baseProps = {
  userId: "u-123",
  userLabel: "Alice Dupont",
  userEmail: "alice@example.com",
  phone: "+33612345678",
  isPending: false,
  userStatus: "APPROVED" as const,
  acceptsNewsletter: true,
  hasWhatsapp: true as boolean | null,
};

describe("UserRowActionsMenu — menu Actions sur /admin/clients", () => {
  afterEach(() => cleanup());

  it("affiche le bouton trois-points et ouvre le menu au clic", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    const trigger = screen.getByRole("button", { name: /actions du client/i });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByText(/Voir la fiche/i)).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText("Voir la fiche")).toBeInTheDocument();
  });

  it("liste les 10 items demandés par la cliente (9 d'origine + Supprimer)", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));

    expect(screen.getByText("Voir la fiche")).toBeInTheDocument();
    expect(screen.getByText("Voir le panier")).toBeInTheDocument();
    expect(screen.getByText("Voir les commandes")).toBeInTheDocument();
    expect(screen.getByText("Produits vus par le client")).toBeInTheDocument();
    expect(screen.getByText("Mettre une remise")).toBeInTheDocument();
    expect(screen.getByText("Mettre une note")).toBeInTheDocument();
    expect(screen.getByText("Créer une commande")).toBeInTheDocument();
    expect(screen.getByText("Envoyer un WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Envoyer un mail")).toBeInTheDocument();
    expect(screen.getByText("Supprimer définitivement")).toBeInTheDocument();
  });

  it("ouvre la modale de confirmation au clic sur « Supprimer définitivement »", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.queryByTestId("delete-modal")).toBeNull();
    fireEvent.click(screen.getByText("Supprimer définitivement"));
    const modal = screen.getByTestId("delete-modal");
    expect(modal).toBeInTheDocument();
    expect(modal.textContent).toContain("Alice Dupont");
  });

  it("affiche « Examiner la demande » au lieu de « Voir la fiche » pour un client PENDING", () => {
    render(<UserRowActionsMenu {...baseProps} isPending />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.getByText("Examiner la demande")).toBeInTheDocument();
    expect(screen.queryByText("Voir la fiche")).toBeNull();
  });

  it("pointe « Mettre une remise » vers l'ancre #remise de la fiche client", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    const link = screen.getByText("Mettre une remise").closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/clients/u-123#remise");
  });

  it("pointe les items d'onglet vers ?tab=... pour deep-link ClientDetailTabs", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.getByText("Voir le panier").closest("a")?.getAttribute("href"))
      .toBe("/admin/clients/u-123?tab=cart");
    expect(screen.getByText("Voir les commandes").closest("a")?.getAttribute("href"))
      .toBe("/admin/clients/u-123?tab=orders");
    expect(screen.getByText("Mettre une note").closest("a")?.getAttribute("href"))
      .toBe("/admin/clients/u-123?tab=note");
    expect(screen.getByText("Produits vus par le client").closest("a")?.getAttribute("href"))
      .toBe("/admin/clients/u-123?tab=productViews");
  });

  it("grise « Envoyer un mail » si le client refuse la newsletter (RGPD)", () => {
    render(<UserRowActionsMenu {...baseProps} acceptsNewsletter={false} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    const item = screen.getByText("Envoyer un mail").closest("[role='menuitem']");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.getAttribute("title")).toMatch(/RGPD/i);
  });

  it("grise « Envoyer un WhatsApp » si le numéro n'est pas confirmé sur WhatsApp", () => {
    render(<UserRowActionsMenu {...baseProps} hasWhatsapp={false} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    const item = screen.getByText("Envoyer un WhatsApp").closest("[role='menuitem']");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.getAttribute("title")).toMatch(/pas sur WhatsApp/i);
  });

  it("grise « Envoyer un WhatsApp » si pas de numéro de téléphone", () => {
    render(<UserRowActionsMenu {...baseProps} phone={null} hasWhatsapp={null} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    const item = screen.getByText("Envoyer un WhatsApp").closest("[role='menuitem']");
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.getAttribute("title")).toMatch(/non renseigné/i);
  });

  it("pointe « Créer une commande » vers la page admin dédiée", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    const link = screen.getByText("Créer une commande").closest("a");
    expect(link?.getAttribute("href")).toBe("/admin/clients/u-123/nouvelle-commande");
  });

  it("affiche « Désactiver le client » uniquement sur un compte APPROVED", () => {
    render(<UserRowActionsMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.getByText("Désactiver le client")).toBeInTheDocument();
  });

  it("masque « Désactiver le client » sur un compte PENDING", () => {
    render(<UserRowActionsMenu {...baseProps} userStatus="PENDING" isPending />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.queryByText("Désactiver le client")).toBeNull();
  });

  it("masque « Désactiver le client » sur un compte DEACTIVATED", () => {
    render(<UserRowActionsMenu {...baseProps} userStatus="DEACTIVATED" />);
    fireEvent.click(screen.getByRole("button", { name: /actions du client/i }));
    expect(screen.queryByText("Désactiver le client")).toBeNull();
  });
});
