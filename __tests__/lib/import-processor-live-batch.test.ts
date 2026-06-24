/**
 * Tests pour le mode « live import » des images (processImageBatch +
 * finalizeImageImport).
 *
 * Couvre :
 *   1. processImageBatch traite un lot et persiste l'état dans tempDir/_state.json
 *   2. Plusieurs lots successifs cumulent les images rangées et les erreurs
 *   3. Erreurs de référence/couleur introuvable sont écrites dans l'état
 *   4. finalizeImageImport crée un brouillon si erreurs + pose les flags marketplaces
 *      + passe le job en COMPLETED
 *   5. finalizeImageImport sans erreurs ne crée pas de brouillon
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  productImageDir: (ref: string) => `mock-storage/produits/${ref}`,
  productImageBaseName: (ref: string, color: string, pos: number) =>
    `${ref}-${color}-${pos}`,
}));

const mockProcessProductImage = vi.fn();
vi.mock("@/lib/image-processor", () => ({
  processProductImage: (...args: unknown[]) => mockProcessProductImage(...args),
}));

// État partagé du mock Prisma — réinitialisé à chaque test
type DbImage = { id: string; productId: string; colorId: string; productColorId: string; path: string; order: number };
type DbProduct = {
  id: string;
  reference: string;
  name: string;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionReferenceBase: string | null;
  colors: Array<{ id: string; colorId: string; saleType: "UNIT" | "PACK"; color: { id: string; name: string; hex: string | null; patternImage: string | null } }>;
};
type DbJob = {
  id: string;
  type: "IMAGES";
  status: string;
  tempDir: string;
  adminId: string;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorDraftId: string | null;
  resultDetails: unknown;
};

const dbState: {
  job: DbJob | null;
  products: DbProduct[];
  images: DbImage[];
  drafts: Array<Record<string, unknown>>;
  productUpdates: Array<{ id: string; data: Record<string, unknown> }>;
} = {
  job: null,
  products: [],
  images: [],
  drafts: [],
  productUpdates: [],
};

let imageIdCounter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importJob: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return dbState.job?.id === where.id ? dbState.job : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<DbJob> }) => {
        if (dbState.job?.id !== where.id) throw new Error("job not found");
        Object.assign(dbState.job, data);
        return dbState.job;
      }),
    },
    product: {
      findMany: vi.fn(async (args: { where?: { reference?: { in: string[] }; id?: { in: string[] } } } = {}) => {
        const where = args.where ?? {};
        if (where.reference?.in) return dbState.products.filter((p) => where.reference!.in.includes(p.reference));
        if (where.id?.in) return dbState.products.filter((p) => where.id!.in.includes(p.id));
        return dbState.products;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        dbState.productUpdates.push({ id: where.id, data });
        return { id: where.id };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    productColorImage: {
      findMany: vi.fn(async ({ where }: { where: { productId: string; colorId: string } }) => {
        return dbState.images.filter((img) => img.productId === where.productId && img.colorId === where.colorId);
      }),
      create: vi.fn(async ({ data }: { data: Omit<DbImage, "id"> }) => {
        const row: DbImage = { id: `img-${++imageIdCounter}`, ...data };
        dbState.images.push(row);
        return row;
      }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    importDraft: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `draft-${dbState.drafts.length + 1}`, ...data };
        dbState.drafts.push(row);
        return row;
      }),
    },
  },
}));

// ─── Import APRÈS les vi.mock pour que le module pioche les mocks ────────────
import { processImageBatch, finalizeImageImport } from "@/lib/import-processor";

let tempDirAbs: string;
let originalCwd: string;

function resetDb() {
  dbState.job = null;
  dbState.products = [];
  dbState.images = [];
  dbState.drafts = [];
  dbState.productUpdates = [];
  imageIdCounter = 0;
}

function setupJob(tempDirRelative: string) {
  dbState.job = {
    id: "job-1",
    type: "IMAGES",
    status: "UPLOADING",
    tempDir: tempDirRelative,
    adminId: "admin-1",
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    errorItems: 0,
    errorDraftId: null,
    resultDetails: null,
  };
}

function addProduct(ref: string, colorName: string, opts: Partial<Pick<DbProduct, "pfsProductId" | "ankorsProductId" | "efashionReferenceBase">> = {}): DbProduct {
  const product: DbProduct = {
    id: `prod-${ref}`,
    reference: ref,
    name: `Produit ${ref}`,
    pfsProductId: opts.pfsProductId ?? null,
    ankorsProductId: opts.ankorsProductId ?? null,
    efashionReferenceBase: opts.efashionReferenceBase ?? null,
    colors: [
      {
        id: `pc-${ref}-${colorName}`,
        colorId: `color-${colorName}`,
        saleType: "UNIT",
        color: {
          id: `color-${colorName}`,
          name: colorName,
          hex: "#000000",
          patternImage: null,
        },
      },
    ],
  };
  dbState.products.push(product);
  return product;
}

function writeFakeImage(filename: string) {
  writeFileSync(path.join(tempDirAbs, filename), Buffer.from("fake"));
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDirAbs = mkdtempSync(path.join(tmpdir(), "live-batch-test-"));
  // Le code utilise `path.resolve(process.cwd(), job.tempDir)` → on stocke
  // tempDir sous forme relative à cwd. On chdir dans le tmpdir pour
  // que la résolution donne tempDirAbs lui-même (tempDir = "").
  process.chdir(tempDirAbs);
  resetDb();
  mockProcessProductImage.mockReset();
  mockProcessProductImage.mockImplementation(async (_buf: Buffer, dir: string, name: string) => ({
    dbPath: `${dir}/${name}.webp`,
  }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDirAbs, { recursive: true, force: true });
});

describe("processImageBatch", () => {
  it("traite un lot et persiste l'état dans _state.json", async () => {
    setupJob("."); // tempDir = cwd = tempDirAbs
    addProduct("REF001", "Doré");
    writeFakeImage("REF001 Doré 1.jpg");

    const result = await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);

    expect(result).toEqual({ processed: 1, success: 1, errors: 0 });
    expect(dbState.images).toHaveLength(1);
    expect(dbState.images[0].productId).toBe("prod-REF001");

    const statePath = path.join(tempDirAbs, "_state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.importedImages).toHaveLength(1);
    expect(state.importedImages[0].filename).toBe("REF001 Doré 1.jpg");
    expect(state.errorRows).toEqual([]);

    // Le fichier source a bien été supprimé après traitement
    expect(existsSync(path.join(tempDirAbs, "REF001 Doré 1.jpg"))).toBe(false);

    expect(dbState.job?.successItems).toBe(1);
    expect(dbState.job?.errorItems).toBe(0);
  });

  it("plusieurs lots successifs cumulent les images rangées", async () => {
    setupJob(".");
    addProduct("REF001", "Doré");
    writeFakeImage("REF001 Doré 1.jpg");
    writeFakeImage("REF001 Doré 2.jpg");

    await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);
    const second = await processImageBatch("job-1", ["REF001 Doré 2.jpg"]);

    expect(second.success).toBe(2);
    expect(dbState.images).toHaveLength(2);
    expect(dbState.images.map((i) => i.order).sort()).toEqual([0, 1]);

    const state = JSON.parse(readFileSync(path.join(tempDirAbs, "_state.json"), "utf-8"));
    expect(state.importedImages).toHaveLength(2);
  });

  it("référence introuvable → erreur dans l'état + image laissée en place", async () => {
    setupJob(".");
    addProduct("REF001", "Doré");
    writeFakeImage("REFXXX Doré 1.jpg");

    const result = await processImageBatch("job-1", ["REFXXX Doré 1.jpg"]);

    expect(result.errors).toBe(1);
    expect(result.success).toBe(0);
    expect(dbState.images).toHaveLength(0);

    const state = JSON.parse(readFileSync(path.join(tempDirAbs, "_state.json"), "utf-8"));
    expect(state.errorRows).toHaveLength(1);
    expect(state.errorRows[0].errors[0]).toContain("introuvable");

    // Fichier source PAS supprimé pour permettre le brouillon
    expect(existsSync(path.join(tempDirAbs, "REFXXX Doré 1.jpg"))).toBe(true);
  });

  it("couleur introuvable sur le produit → erreur dans l'état", async () => {
    setupJob(".");
    addProduct("REF001", "Doré");
    writeFakeImage("REF001 Rouge 1.jpg");

    const result = await processImageBatch("job-1", ["REF001 Rouge 1.jpg"]);

    expect(result.errors).toBe(1);
    const state = JSON.parse(readFileSync(path.join(tempDirAbs, "_state.json"), "utf-8"));
    expect(state.errorRows[0].errors[0]).toContain("Rouge");
  });

  it("nom de fichier invalide → erreur de parsing", async () => {
    setupJob(".");
    writeFakeImage("invalid.jpg");

    const result = await processImageBatch("job-1", ["invalid.jpg"]);

    expect(result.errors).toBe(1);
    const state = JSON.parse(readFileSync(path.join(tempDirAbs, "_state.json"), "utf-8"));
    expect(state.errorRows[0].errors[0]).toContain("invalide");
  });

  it("applique les overrides de couleur déposés dans _overrides.json", async () => {
    setupJob(".");
    addProduct("REF001", "Argenté");
    writeFakeImage("REF001 Doré 1.jpg");
    writeFileSync(
      path.join(tempDirAbs, "_overrides.json"),
      JSON.stringify({ "REF001 Doré 1.jpg": { color: "Argenté" } }),
    );

    const result = await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);

    expect(result.success).toBe(1);
    expect(dbState.images[0].colorId).toBe("color-Argenté");
  });
});

describe("finalizeImageImport", () => {
  it("sans erreur : passe le job en COMPLETED et ne crée pas de brouillon", async () => {
    setupJob(".");
    addProduct("REF001", "Doré");
    writeFakeImage("REF001 Doré 1.jpg");
    await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);

    await finalizeImageImport("job-1");

    expect(dbState.job?.status).toBe("COMPLETED");
    expect(dbState.job?.errorDraftId).toBeUndefined();
    expect(dbState.drafts).toHaveLength(0);
  });

  it("avec erreurs : crée un brouillon avec les rows d'erreur", async () => {
    setupJob(".");
    addProduct("REF001", "Doré");
    writeFakeImage("REF001 Doré 1.jpg");
    writeFakeImage("REFXXX Doré 1.jpg");

    await processImageBatch("job-1", ["REF001 Doré 1.jpg", "REFXXX Doré 1.jpg"]);
    await finalizeImageImport("job-1");

    expect(dbState.job?.status).toBe("COMPLETED");
    expect(dbState.drafts).toHaveLength(1);
    expect(dbState.job?.errorDraftId).toBe("draft-1");
    const draft = dbState.drafts[0];
    expect(draft.successRows).toBe(1);
    expect(draft.errorRows).toBe(1);
    expect((draft.rows as unknown as Array<{ filename: string }>)[0].filename).toBe("REFXXX Doré 1.jpg");
  });

  it("pose les flags SyncRequired sur les produits liés aux marketplaces", async () => {
    setupJob(".");
    addProduct("REF001", "Doré", { pfsProductId: "pfs-42", ankorsProductId: "ank-42" });
    writeFakeImage("REF001 Doré 1.jpg");
    await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);

    await finalizeImageImport("job-1");

    const flagged = dbState.productUpdates.find((u) => u.id === "prod-REF001");
    expect(flagged).toBeDefined();
    expect(flagged!.data).toEqual({ pfsSyncRequired: true, ankorsSyncRequired: true });
  });

  it("aucun flag posé sur un produit non lié à une marketplace", async () => {
    setupJob(".");
    addProduct("REF001", "Doré"); // sans marketplace
    writeFakeImage("REF001 Doré 1.jpg");
    await processImageBatch("job-1", ["REF001 Doré 1.jpg"]);

    await finalizeImageImport("job-1");

    expect(dbState.productUpdates).toHaveLength(0);
  });
});
