import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BulkActionBar, { type BulkBarProduct } from "@/components/admin/products/BulkActionBar";

vi.mock("@/components/admin/products/MarketplaceRefreshContext", () => ({
  useMarketplaceRefreshQueue: () => ({ items: [] }),
  isItemActive: () => false,
}));

vi.mock("@/components/admin/products/MarketplaceExportButton", () => ({
  default: () => null,
}));

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
    pfsSyncRequired: overrides.pfsSyncRequired ?? false,
    ankorsSyncRequired: overrides.ankorsSyncRequired ?? false,
    efashionSyncRequired: overrides.efashionSyncRequired ?? false,
    faireSyncRequired: overrides.faireSyncRequired ?? false,
  };
}

const baseProps = {
  isPending: false,
  marketplaces: {
    pfs: { available: true },
    ankorstore: { configured: false, enabled: false },
    efashion: { configured: false, enabled: false },
    faire: { configured: false, enabled: false },
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
  onOpenTagsModal: () => {},
  onOpenCollectionModal: () => {},
};

function getMarketplacesButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Marketplaces|MP/i }) as HTMLButtonElement;
}

describe("BulkActionBar — bouton Marketplaces actif quand resynchro forcée possible", () => {
  it("est grisé quand la sélection n'a rien à publier ni à synchroniser sur aucune marketplace", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[mkProduct({ id: "1", status: "OFFLINE", isIncomplete: true })]}
      />,
    );
    const btn = getMarketplacesButton();
    expect(btn.className).toContain("cursor-not-allowed");
    expect(btn.className).not.toContain("from-fuchsia-500");
  });

  it("est actif quand un produit publié est sélectionné (permet la resynchro forcée)", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE", pfsProductId: "pfs-42" }),
        ]}
      />,
    );
    const btn = getMarketplacesButton();
    expect(btn.className).toContain("from-fuchsia-500");
    expect(btn.className).not.toContain("cursor-not-allowed");
  });

  it("reste grisé si le seul produit publié l'est sur une marketplace non disponible", () => {
    render(
      <BulkActionBar
        {...baseProps}
        marketplaces={{
          pfs: { available: false },
          ankorstore: { configured: false, enabled: false },
          efashion: { configured: false, enabled: false },
          faire: { configured: false, enabled: false },
        }}
        selectedProducts={[
          mkProduct({ id: "1", status: "ONLINE", pfsProductId: "pfs-42" }),
        ]}
      />,
    );
    const btn = getMarketplacesButton();
    expect(btn.className).toContain("cursor-not-allowed");
  });
});
