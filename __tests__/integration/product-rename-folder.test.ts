/**
 * Integration test: when an admin changes a product's reference, the
 * matching folder under `public/uploads/produits/` is renamed AND the
 * `ProductColorImage.path` rows are updated to follow.
 *
 * Uses the real DB and the real filesystem (operating on a per-test
 * scratch folder under a temporary `cwd`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, updateProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("Product reference change → folder rename (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let originalCwd: string;
  let tmpRoot: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rename-folder-it-"));
    await fs.mkdir(path.join(tmpRoot, "public"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "private"), { recursive: true });
    process.chdir(tmpRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  function buildInput(reference: string, overrides?: Partial<ProductInput>): ProductInput {
    return {
      reference,
      name: "Bague test rename",
      description: "Description",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 9.99,
          weight: 0.15,
          stock: 100,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "OFFLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      manufacturingCountryId: entities.country.id,
      seasonId: entities.season.id,
      ...overrides,
    };
  }

  it("renames the folder + the file paths in DB when the reference changes", async () => {
    const oldRef = `${TEST_PREFIX}RENAME-OLD`;
    const newRef = `${TEST_PREFIX}RENAME-NEW`;
    const oldSlug = oldRef.toLowerCase();
    const newSlug = newRef.toLowerCase();

    // 1. Create the product (no image yet — server action doesn't upload, the
    //    upload is a separate step in the real UI).
    const { id } = await createProduct(buildInput(oldRef));

    // 2. Pretend the admin uploaded an image: write a file on disk and
    //    record the matching ProductColorImage row.
    const oldDir = path.join(tmpRoot, "public", "uploads", "produits", oldSlug);
    await fs.mkdir(oldDir, { recursive: true });
    const oldFiles = [
      `${oldSlug}-doré-1.webp`,
      `${oldSlug}-doré-1-md.webp`,
      `${oldSlug}-doré-1-thumb.webp`,
    ];
    for (const f of oldFiles) {
      await fs.writeFile(path.join(oldDir, f), Buffer.from("test"));
    }

    const variant = await prisma.productColor.findFirstOrThrow({
      where: { productId: id },
      select: { id: true, colorId: true },
    });
    await prisma.productColorImage.create({
      data: {
        productId: id,
        colorId: variant.colorId ?? "",
        productColorId: null,
        path: `/uploads/produits/${oldSlug}/${oldSlug}-doré-1.webp`,
        order: 0,
      },
    });

    // 3. Update the reference.
    await updateProduct(id, buildInput(newRef));

    // 4. The folder should have been renamed on disk.
    const newDir = path.join(tmpRoot, "public", "uploads", "produits", newSlug);
    const stillExists = await fs.stat(oldDir).catch(() => null);
    expect(stillExists).toBeNull();
    const newDirStat = await fs.stat(newDir);
    expect(newDirStat.isDirectory()).toBe(true);

    const newDirContents = (await fs.readdir(newDir)).sort();
    expect(newDirContents).toEqual([
      `${newSlug}-doré-1-md.webp`,
      `${newSlug}-doré-1-thumb.webp`,
      `${newSlug}-doré-1.webp`,
    ]);

    // 5. The DB path should have been updated too.
    const updated = await prisma.productColorImage.findFirstOrThrow({
      where: { productId: id },
      select: { path: true },
    });
    expect(updated.path).toBe(`/uploads/produits/${newSlug}/${newSlug}-doré-1.webp`);
  });

  it("is a no-op when the reference doesn't change", async () => {
    const ref = `${TEST_PREFIX}RENAME-NOOP`;
    const slug = ref.toLowerCase();
    const { id } = await createProduct(buildInput(ref));

    const dir = path.join(tmpRoot, "public", "uploads", "produits", slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${slug}-1.webp`), "x");

    // Same reference → no rename, no DB change.
    await updateProduct(id, buildInput(ref));

    const stillThere = await fs.readdir(dir);
    expect(stillThere).toContain(`${slug}-1.webp`);
  });
});
