import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Application du code couleur PFS lors de la création / liaison de mappings :
 *  - Création d'une nouvelle couleur → hex normalisé persisté.
 *  - Liaison à une couleur existante sans hex → on remplit le hex.
 *  - Liaison à une couleur existante avec hex → on respecte la valeur en place.
 *  - Hex invalide → on n'écrit rien (pas d'erreur silencieuse côté CSS).
 */

const {
  mockColorUpdate,
  mockColorCreate,
  mockColorFindUnique,
} = vi.hoisted(() => ({
  mockColorUpdate: vi.fn(),
  mockColorCreate: vi.fn(),
  mockColorFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    color: { update: mockColorUpdate, create: mockColorCreate, findUnique: mockColorFindUnique },
    size: { update: vi.fn(), create: vi.fn() },
    composition: { update: vi.fn(), create: vi.fn() },
    manufacturingCountry: { update: vi.fn(), create: vi.fn() },
    season: { update: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateComposition: vi.fn(),
  autoTranslateManufacturingCountry: vi.fn(),
  autoTranslateSeason: vi.fn(),
  autoTranslateProduct: vi.fn(),
}));

vi.mock("@/lib/pfs-api", () => ({
  pfsListProducts: vi.fn(),
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));

vi.mock("@/lib/image-processor", () => ({ processProductImage: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  keyFromDbPath: vi.fn(),
  deleteFiles: vi.fn(),
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn(() => "SKU") }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createOrLinkMapping } from "@/lib/pfs-import";

describe("createOrLinkMapping — code couleur PFS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persiste le hex normalisé en minuscules à la création", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-1", name: "Doré" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "GOLDEN",
      label: "Doré",
      hex: "#C4A647",
    });
    expect(mockColorCreate).toHaveBeenCalledWith({
      data: { name: "Doré", hex: "#c4a647" },
      select: { id: true, name: true },
    });
  });

  it("ajoute le préfixe # quand PFS renvoie le hex sans dièse", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-2", name: "Noir" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "BLACK",
      label: "Noir",
      hex: "000000",
    });
    expect(mockColorCreate).toHaveBeenCalledWith({
      data: { name: "Noir", hex: "#000000" },
      select: { id: true, name: true },
    });
  });

  it("stocke null quand le hex PFS est invalide", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-3", name: "Inconnu" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "UNKNOWN",
      label: "Inconnu",
      hex: "pas-un-hex",
    });
    expect(mockColorCreate).toHaveBeenCalledWith({
      data: { name: "Inconnu", hex: null },
      select: { id: true, name: true },
    });
  });

  it("stocke null quand aucun hex n'est fourni", async () => {
    mockColorCreate.mockResolvedValue({ id: "col-4", name: "Sans hex" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "NOHEX",
      label: "Sans hex",
    });
    expect(mockColorCreate).toHaveBeenCalledWith({
      data: { name: "Sans hex", hex: null },
      select: { id: true, name: true },
    });
  });

  it("remplit le hex d'une couleur existante qui n'en avait pas", async () => {
    mockColorFindUnique.mockResolvedValue({ hex: null });
    mockColorUpdate.mockResolvedValue({ id: "col-5", name: "Doré" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "GOLDEN",
      label: "Doré",
      linkToExistingId: "col-5",
      hex: "#C4A647",
    });
    expect(mockColorUpdate).toHaveBeenCalledWith({
      where: { id: "col-5" },
      data: { hex: "#c4a647" },
      select: { id: true, name: true },
    });
  });

  it("ne touche pas au hex d'une couleur existante qui en a déjà un", async () => {
    mockColorFindUnique.mockResolvedValue({ hex: "#aabbcc" });
    mockColorUpdate.mockResolvedValue({ id: "col-6", name: "Doré" });
    await createOrLinkMapping({
      type: "color",
      pfsRef: "GOLDEN",
      label: "Doré",
      linkToExistingId: "col-6",
      hex: "#C4A647",
    });
    expect(mockColorUpdate).toHaveBeenCalledWith({
      where: { id: "col-6" },
      data: {},
      select: { id: true, name: true },
    });
  });
});
