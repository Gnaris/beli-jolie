import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BulkActionBar, { type BulkBarProduct } from "@/components/admin/products/BulkActionBar";

vi.mock("@/components/admin/products/MarketplaceRefreshContext", () => ({
  useMarketplaceRefreshQueue: () => ({ items: [] }),
  isItemActive: () => false,
}));

vi.mock("@/components/admin/products/MarketplaceExportButton", () => ({
  default: () => null,
}));

function mkProduct(id: string, status: BulkBarProduct["status"] = "ONLINE"): BulkBarProduct {
  return {
    id,
    reference: `REF-${id}`,
    name: `Produit ${id}`,
    status,
    isIncomplete: status === "OFFLINE",
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

describe("BulkActionBar — bouton Publier brouillons", () => {
  it("n'affiche pas le bouton quand aucun brouillon n'est sélectionné", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[mkProduct("1", "ONLINE"), mkProduct("2", "ONLINE")]}
        draftCount={0}
        onPublishDrafts={() => {}}
      />,
    );
    expect(screen.queryByText(/Publier brouillons/i)).toBeNull();
  });

  it("affiche le bouton avec le compteur quand au moins un brouillon est sélectionné", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[
          mkProduct("1", "ONLINE"),
          mkProduct("2", "OFFLINE"),
          mkProduct("3", "OFFLINE"),
        ]}
        draftCount={2}
        onPublishDrafts={() => {}}
      />,
    );
    const btn = screen.getByTitle(/Vérifier si les brouillons/i);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("2");
  });

  it("appelle onPublishDrafts au clic", () => {
    const onPublishDrafts = vi.fn();
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[mkProduct("1", "OFFLINE")]}
        draftCount={1}
        onPublishDrafts={onPublishDrafts}
      />,
    );
    fireEvent.click(screen.getByTitle(/Vérifier si les brouillons/i));
    expect(onPublishDrafts).toHaveBeenCalledTimes(1);
  });

  it("n'affiche pas le bouton si onPublishDrafts n'est pas fourni (compat)", () => {
    render(
      <BulkActionBar
        {...baseProps}
        selectedProducts={[mkProduct("1", "OFFLINE")]}
        draftCount={1}
      />,
    );
    expect(screen.queryByText(/Publier brouillons/i)).toBeNull();
  });
});
