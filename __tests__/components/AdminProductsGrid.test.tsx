import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import AdminProductsGrid from "@/components/admin/products/AdminProductsGrid";
import type { AdminProduct } from "@/components/admin/products/AdminProductsTable";

/**
 * Vue grille des produits admin — nouveau mode d'affichage optionnel.
 * Tests : rendu d'une carte par produit, chips marketplace grisés quand
 * non liés, checkbox de sélection fonctionnelle, statut affiché.
 */

// next/link mock (évite le warning de manque de router en test)
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

const baseProduct: AdminProduct = {
  id: "p1",
  reference: "A1720",
  name: "Robe longue plissée",
  status: "ONLINE",
  isIncomplete: false,
  colorsMissingImageCount: 0,
  discountPercent: null,
  missingFields: [],
  locked: false,
  important: false,
  categoryName: "Robes",
  subCategoryName: null,
  subCategoryNames: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastRefreshedAt: null,
  firstImage: null,
  pfsProductId: "pfs-123",       // lié PFS
  ankorsProductId: null,          // pas lié Ankor
  efashionReferenceBase: null,
  faireProductId: null,
  orderchampProductId: null,
  pfsSyncRequired: false,
  ankorsSyncRequired: false,
  efashionSyncRequired: false,
  faireSyncRequired: false,
  orderchampSyncRequired: false,
  microstoreSyncRequired: false,
  microstoreLastPushedAt: null,
  pfsEnabled: true,
  ankorsEnabled: true,
  efashionEnabled: true,
  faireEnabled: true,
  orderchampEnabled: true,
  microstoreEnabled: true,
  pfsLastExportedAt: null,
  efashionLastExportedAt: null,
  microstoreLastExportedAt: null,
  ankorstoreLastExportedAt: null,
  faireLastExportedAt: null,
  orderchampLastExportedAt: null,
  pfsCheckedAt: null,
  pfsCheckStatus: null,
  pfsCheckIssues: null,
  primaryColorId: "c1",
  colors: [
    {
      id: "v1",
      colorId: "c1",
      unitPrice: 12.5,
      weight: 0.2,
      stock: 48,
      isPrimary: true,
      disabled: false,
      saleType: "UNIT" as const,
      packQuantity: null,
      variantSizes: [],
      color: { name: "Bleu", hex: "#1e40af", patternImage: null },
    },
  ],
  translations: [{ locale: "fr" }, { locale: "en" }],
};

const baseFlags = {
  hasPfsConfig: true,
  pfsGloballyEnabled: true,
  hasAnkorstoreConfig: true,
  ankorstoreEnabled: true,
  hasEfashionConfig: true,
  efashionEnabled: true,
  hasFaireConfig: true,
  faireEnabled: true,
  hasOrderchampConfig: true,
  orderchampEnabled: true,
  hasMicrostoreConfig: true,
  microstoreEnabled: true,
};

describe("AdminProductsGrid", () => {
  afterEach(() => cleanup());

  it("rend une carte <article> par produit", () => {
    const { container } = render(
      <AdminProductsGrid
        products={[baseProduct, { ...baseProduct, id: "p2", reference: "B0842", name: "Gilet" }]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(screen.getByText("Robe longue plissée")).toBeTruthy();
    expect(screen.getByText("Gilet")).toBeTruthy();
    expect(screen.getByText("A1720")).toBeTruthy();
  });

  it("affiche le prix minimum et le stock total", () => {
    render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    expect(screen.getByText("12.50 €")).toBeTruthy();
    expect(screen.getByText("48 pcs")).toBeTruthy();
  });

  it("BrandChip PFS lié = pleine opacité ; Ankor non lié = grisé", () => {
    const { container } = render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    // Le chip PFS (P) : titre "publié"
    const pfsChip = container.querySelector('[title*="Paris Fashion Shop"]') as HTMLElement | null;
    expect(pfsChip).not.toBeNull();
    expect(pfsChip!.getAttribute("title")).toContain("publié");
    expect(pfsChip!.style.opacity).toBe("1");
    // Le chip Ankor (A) : titre "non publié" et opacity 0.3
    const ankorChip = container.querySelector('[title*="Ankorstore"]') as HTMLElement | null;
    expect(ankorChip).not.toBeNull();
    expect(ankorChip!.getAttribute("title")).toContain("non publié");
    expect(ankorChip!.style.opacity).toBe("0.3");
  });

  it("checkbox déclenche toggleSelect avec l'id du produit", () => {
    const spy = vi.fn();
    render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={spy}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    const cb = screen.getByLabelText(/Sélectionner Robe longue plissée/) as HTMLInputElement;
    fireEvent.click(cb);
    expect(spy).toHaveBeenCalledWith("p1");
  });

  it("statut ONLINE => pastille verte « En ligne »", () => {
    render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    expect(screen.getByText("En ligne")).toBeTruthy();
  });

  it("pendingStatuses écrase le statut affiché", () => {
    render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{ p1: "OFFLINE" }}
        deletingIds={new Set()}
      />,
    );
    // La pastille devient « Hors ligne » car status en attente = OFFLINE
    expect(screen.getByText("Hors ligne")).toBeTruthy();
    expect(screen.queryByText("En ligne")).toBeNull();
  });

  it("cartes non-configurées : masque les chips marketplaces désactivés globalement", () => {
    const { container } = render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        hasFaireConfig={false}          // Faire non configuré => chip masqué
        faireEnabled={false}
        hasOrderchampConfig={false}
        orderchampEnabled={false}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    expect(container.querySelector('[title*="Faire"]')).toBeNull();
    expect(container.querySelector('[title*="Orderchamp"]')).toBeNull();
    // Les 4 restants sont là
    expect(container.querySelector('[title*="Paris Fashion Shop"]')).not.toBeNull();
    expect(container.querySelector('[title*="Ankorstore"]')).not.toBeNull();
    expect(container.querySelector('[title*="eFashion"]')).not.toBeNull();
    expect(container.querySelector('[title*="Microstore"]')).not.toBeNull();
  });

  it("la ligne de chips est un bouton accessible « Gérer les marketplaces »", () => {
    const { container } = render(
      <AdminProductsGrid
        products={[baseProduct]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    const trigger = container.querySelector('button[aria-label="Gérer les marketplaces de ce produit"]');
    expect(trigger).not.toBeNull();
    // Le bouton contient bien les chips marketplace
    expect(trigger!.querySelector('[title*="Paris Fashion Shop"]')).not.toBeNull();
    expect(trigger!.querySelector('[title*="Microstore"]')).not.toBeNull();
  });

  it("sync nécessaire => petit rond ambre en surimpression sur le chip", () => {
    const { container } = render(
      <AdminProductsGrid
        products={[{ ...baseProduct, pfsSyncRequired: true }]}
        {...baseFlags}
        selectedIds={new Set()}
        toggleSelect={() => {}}
        pendingStatuses={{}}
        deletingIds={new Set()}
      />,
    );
    const pfsChip = container.querySelector('[title*="Paris Fashion Shop"]') as HTMLElement;
    expect(pfsChip.getAttribute("title")).toContain("sync nécessaire");
    // Vérifie qu'il y a un rond ambre à l'intérieur
    const dot = pfsChip.querySelector(".bg-amber-500");
    expect(dot).not.toBeNull();
  });
});
