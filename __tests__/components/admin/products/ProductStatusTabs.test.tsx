import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

const pushMock = vi.fn();
let searchParamsString = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

vi.mock("@/components/admin/products/FilterPendingContext", () => ({
  useFilterPending: () => ({
    isFiltering: false,
    startFiltering: (cb: () => void) => cb(),
  }),
}));

import ProductStatusTabs from "@/components/admin/products/ProductStatusTabs";

const baseCounts = {
  all: 120,
  online: 40,
  offline: 60,
  draft: 10,
  archived: 10,
  important: 7,
  createdRecent: 15,
  updatedRecent: 22,
};

describe("ProductStatusTabs — bouton Important", () => {
  beforeEach(() => {
    pushMock.mockReset();
    searchParamsString = "";
  });
  afterEach(() => cleanup());

  it("affiche le bouton Important avec son compteur", () => {
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Important/ });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain("7");
  });

  it("active le filtre important=1 quand on clique dessus (état initial inactif)", () => {
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Important/ });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("important=1");
  });

  it("retire important=1 quand le filtre est déjà actif", () => {
    searchParamsString = "important=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Important/ });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("important=1");
  });

  it("préserve le filtre status quand on toggle Important", () => {
    searchParamsString = "status=ONLINE";
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Important/ });
    fireEvent.click(btn);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("status=ONLINE");
    expect(url).toContain("important=1");
  });

  it("remet la page à 1 (supprime ?page) lorsqu'on toggle Important", () => {
    searchParamsString = "page=5";
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Important/ });
    fireEvent.click(btn);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("page=5");
  });

  it("cliquer sur un onglet de statut ne touche pas au filtre Important", () => {
    searchParamsString = "important=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    const onlineBtn = screen.getByRole("button", { name: /En ligne/ });
    fireEvent.click(onlineBtn);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("status=ONLINE");
    expect(url).toContain("important=1");
  });
});

describe("ProductStatusTabs — raccourcis Modifié récemment / Créé récemment", () => {
  beforeEach(() => {
    pushMock.mockReset();
    searchParamsString = "";
  });
  afterEach(() => cleanup());

  it("affiche les deux boutons avec leurs compteurs", () => {
    render(<ProductStatusTabs counts={baseCounts} />);
    const modifBtn = screen.getByRole("button", { name: /Modifié récemment/ });
    const creeBtn = screen.getByRole("button", { name: /Créé récemment/ });
    expect(modifBtn.textContent).toContain("22");
    expect(creeBtn.textContent).toContain("15");
  });

  it("active updatedRecent=1 au clic sur Modifié récemment", () => {
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Modifié récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("updatedRecent=1");
  });

  it("active createdRecent=1 au clic sur Créé récemment", () => {
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Créé récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("createdRecent=1");
  });

  it("retire updatedRecent=1 quand déjà actif", () => {
    searchParamsString = "updatedRecent=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    const btn = screen.getByRole("button", { name: /Modifié récemment/ });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("updatedRecent=1");
  });

  it("activer Modifié récemment quand Créé récemment est actif → retire Créé récemment (exclusif)", () => {
    searchParamsString = "createdRecent=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Modifié récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("updatedRecent=1");
    expect(url).not.toContain("createdRecent=1");
  });

  it("activer Créé récemment quand Modifié récemment est actif → retire Modifié récemment (exclusif)", () => {
    searchParamsString = "updatedRecent=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Créé récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("createdRecent=1");
    expect(url).not.toContain("updatedRecent=1");
  });

  it("Important reste cumulable avec Modifié récemment / Créé récemment", () => {
    searchParamsString = "important=1&createdRecent=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Modifié récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("important=1");
    expect(url).toContain("updatedRecent=1");
    expect(url).not.toContain("createdRecent=1");
  });

  it("désactiver Créé récemment (sans en activer un autre) ne touche pas Modifié récemment", () => {
    // Cas rare (état invalide) mais on vérifie que la désactivation reste locale.
    searchParamsString = "createdRecent=1";
    render(<ProductStatusTabs counts={baseCounts} />);
    fireEvent.click(screen.getByRole("button", { name: /Créé récemment/ }));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("createdRecent=1");
    expect(url).not.toContain("updatedRecent=1");
  });
});
