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

function mkProduct(id: string): BulkBarProduct {
  return {
    id,
    reference: `REF-${id}`,
    name: `Produit ${id}`,
    status: "ONLINE",
    isIncomplete: false,
    locked: false,
    firstImage: null,
    pfsProductId: null,
    ankorsProductId: null,
    efashionReferenceBase: null,
    faireProductId: null,
    pfsSyncRequired: false,
    ankorsSyncRequired: false,
    efashionSyncRequired: false,
    faireSyncRequired: false,
  };
}

const baseProps = {
  selectedProducts: [mkProduct("1"), mkProduct("2"), mkProduct("3")],
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
};

describe("BulkActionBar — pendingLabel", () => {
  it("n'affiche pas de badge « en cours » quand pendingLabel est null", () => {
    render(<BulkActionBar {...baseProps} pendingLabel={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("affiche le badge avec le libellé fourni quand pendingLabel est défini", () => {
    render(<BulkActionBar {...baseProps} pendingLabel="Traduction de 3 produits en cours…" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("Traduction de 3 produits en cours…");
  });

  it("traite pendingLabel absent (undefined) comme pas d'action en cours", () => {
    render(<BulkActionBar {...baseProps} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
