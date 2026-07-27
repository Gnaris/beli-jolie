import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BulkActionBar, { type BulkBarProduct } from "@/components/admin/products/BulkActionBar";

vi.mock("@/components/admin/products/MarketplaceRefreshContext", () => ({
  useMarketplaceRefreshQueue: () => ({ items: [] }),
  isItemActive: () => false,
}));

vi.mock("@/components/admin/products/MarketplaceMaintenanceContext", () => ({
  useMarketplaceMaintenance: () => ({ pfs: false, ankorstore: false, efashion: false, faire: false }),
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
  onSetImportant: () => {},
  onOpenTagsModal: () => {},
  onOpenCollectionModal: () => {},
};

describe("BulkActionBar — sticky top", () => {
  it("le wrapper de la barre est sticky top-4 avec z-40 (pas de max-width, largeur pleine du parent)", () => {
    const { container } = render(
      <BulkActionBar {...baseProps} selectedProducts={[mkProduct("1")]} />,
    );
    // Premier div = wrapper d'animation qui porte les classes sticky.
    // Le premier enfant est la sentinelle 1px pour l'IntersectionObserver ;
    // le wrapper sticky est le 2ᵉ enfant.
    const wrapper = container.children[1] as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toMatch(/\bsticky\b/);
    expect(wrapper.className).toMatch(/\btop-4\b/);
    expect(wrapper.className).toMatch(/\bz-40\b/);
    // Pas de max-width : la barre garde sa largeur d'origine.
    expect(wrapper.className).not.toMatch(/max-w-/);
  });

  it("conserve les classes sticky même quand la sélection est vide (bar invisible mais réservée)", () => {
    const { container } = render(
      <BulkActionBar {...baseProps} selectedProducts={[]} />,
    );
    // Le premier enfant est la sentinelle 1px pour l'IntersectionObserver ;
    // le wrapper sticky est le 2ᵉ enfant.
    const wrapper = container.children[1] as HTMLElement;
    expect(wrapper.className).toMatch(/\bsticky\b/);
    expect(wrapper.className).toMatch(/\btop-4\b/);
    // Height 0 + opacity 0 quand rien n'est sélectionné.
    expect(wrapper.className).toMatch(/grid-rows-\[0fr\]/);
    expect(wrapper.className).toMatch(/opacity-0/);
  });
});
