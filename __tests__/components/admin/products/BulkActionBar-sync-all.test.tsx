import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import BulkActionBar, { type BulkBarProduct } from "@/components/admin/products/BulkActionBar";

// Mock des dépendances lourdes non pertinentes pour ce test.
vi.mock("@/components/admin/products/MarketplaceRefreshContext", () => ({
  useMarketplaceRefreshQueue: () => ({ items: [] }),
  isItemActive: () => false,
}));

vi.mock("@/components/admin/products/MarketplaceExportButton", () => ({
  default: () => null,
}));

// jsdom n'implémente pas matchMedia — nécessaire dès qu'on ouvre le panneau
// Marketplaces (BulkActionBar l'utilise pour verrouiller le scroll mobile).
beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function mkProduct(overrides: Partial<BulkBarProduct>): BulkBarProduct {
  return {
    id: overrides.id ?? "prod-x",
    reference: overrides.reference ?? "REF-X",
    name: overrides.name ?? "Produit",
    status: overrides.status ?? "ONLINE",
    isIncomplete: overrides.isIncomplete ?? false,
    locked: overrides.locked ?? false,
    firstImage: overrides.firstImage ?? null,
    pfsProductId: overrides.pfsProductId ?? null,
    ankorsProductId: overrides.ankorsProductId ?? null,
    efashionReferenceBase: overrides.efashionReferenceBase ?? null,
    faireProductId: overrides.faireProductId ?? null,
    orderchampProductId: overrides.orderchampProductId ?? null,
    pfsSyncRequired: overrides.pfsSyncRequired ?? false,
    ankorsSyncRequired: overrides.ankorsSyncRequired ?? false,
    efashionSyncRequired: overrides.efashionSyncRequired ?? false,
    faireSyncRequired: overrides.faireSyncRequired ?? false,
    orderchampSyncRequired: overrides.orderchampSyncRequired ?? false,
  };
}

const baseProps = {
  isPending: false,
  marketplaces: {
    pfs: { available: true },
    ankorstore: { configured: true, enabled: true },
    efashion: { configured: true, enabled: true },
    faire: { configured: true, enabled: true },
    orderchamp: { configured: true, enabled: true },
    microstore: { configured: true },
  },
  onStatus: () => {},
  onDelete: () => {},
  onRefresh: () => {},
  onEditAttributes: () => {},
  onTranslateAll: () => {},
  onDeselectAll: () => {},
  onMarketplacePublish: () => {},
  onMarketplaceSync: () => {},
  onSetBestSeller: () => {},
  onSetImportant: () => {},
  onOpenTagsModal: () => {},
  onOpenCollectionModal: () => {},
};

function openMarketplacePanel() {
  const btn = screen.getByRole("button", { name: /Marketplaces|MP/i });
  fireEvent.click(btn);
}

describe("BulkActionBar — bouton « Tout synchroniser »", () => {
  it("affiche « Tout synchroniser » quand au moins un produit est lié à une marketplace", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE", pfsProductId: "pfs-1" }),
          mkProduct({ id: "2", status: "ONLINE", faireProductId: "faire-2" }),
        ]}
        onSyncAll={() => {}}
      />,
    );
    openMarketplacePanel();
    expect(screen.getByText("Tout synchroniser")).toBeInTheDocument();
  });

  it("compte les produits uniques ayant au moins un lien marketplace (pas la somme par MP)", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          // Produit lié à 3 marketplaces — doit être compté 1 seule fois.
          mkProduct({
            id: "1",
            status: "ONLINE",
            pfsProductId: "pfs-1",
            ankorsProductId: "ank-1",
            faireProductId: "faire-1",
          }),
          // Produit lié à 1 marketplace.
          mkProduct({ id: "2", status: "ONLINE", pfsProductId: "pfs-2" }),
          // Produit sans lien — exclu du compteur.
          mkProduct({ id: "3", status: "ONLINE" }),
        ]}
        onSyncAll={() => {}}
      />,
    );
    openMarketplacePanel();
    // 2 produits ont un lien marketplace, pas 5 (somme brute des liens).
    const syncAllLabel = screen.getByText("Tout synchroniser");
    const syncAllCard = syncAllLabel.closest("button");
    expect(syncAllCard).not.toBeNull();
    expect(syncAllCard!.textContent).toContain("2 produits");
    expect(syncAllCard!.textContent).toContain("sur toutes leurs marketplaces liées");
  });

  it("cache le bouton quand aucun produit sélectionné n'est lié à une marketplace", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE" }),
          mkProduct({ id: "2", status: "OFFLINE" }),
        ]}
        onSyncAll={() => {}}
      />,
    );
    openMarketplacePanel();
    // Le panneau affiche « Aucune action possible » et pas de « Tout synchroniser ».
    expect(screen.queryByText("Tout synchroniser")).toBeNull();
  });

  it("n'apparaît pas si onSyncAll n'est pas fourni (compat)", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE", pfsProductId: "pfs-1" }),
        ]}
      />,
    );
    openMarketplacePanel();
    expect(screen.queryByText("Tout synchroniser")).toBeNull();
  });

  it("appelle onSyncAll au clic", () => {
    const onSyncAll = vi.fn();
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE", pfsProductId: "pfs-1" }),
        ]}
        onSyncAll={onSyncAll}
      />,
    );
    openMarketplacePanel();
    fireEvent.click(screen.getByText("Tout synchroniser"));
    expect(onSyncAll).toHaveBeenCalledTimes(1);
  });
});
