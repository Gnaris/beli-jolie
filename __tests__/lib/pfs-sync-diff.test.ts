import { describe, it, expect } from "vitest";
import {
  diffSnapshots,
  diffIsEmpty,
  productFieldsEqual,
  variantSnapshotEqual,
  PFS_SNAPSHOT_VERSION,
  type PfsSyncSnapshot,
  type PfsProductFieldsSnapshot,
} from "@/lib/pfs-sync-diff";

const baseProduct: PfsProductFieldsSnapshot = {
  nameSource: "Bague étoile",
  descSource: "Belle bague",
  dimensions: "",
  composition: [{ id: "ACIERINOXYDABLE", value: 100 }],
  country: "CN",
  season: "PE2026",
  brand: "Ma Boutique",
  gender: "WOMAN",
  category: "CAT-1",
  family: "FAM-1",
  sizeDetailsTu: null,
};

function makeSnapshot(overrides: Partial<PfsSyncSnapshot> = {}): PfsSyncSnapshot {
  return {
    schemaVersion: PFS_SNAPSHOT_VERSION,
    product: baseProduct,
    defaultColor: "GOLDEN",
    variants: {
      VAR1: { price: 9.9, stock: 10, weight: 5, isActive: true },
      VAR2: { price: 12, stock: 0, weight: 6, isActive: false },
    },
    images: {
      GOLDEN: { "1": "/uploads/products/a.webp", "2": "/uploads/products/b.webp" },
      SILVER: { "1": "/uploads/products/c.webp" },
    },
    status: "READY_FOR_SALE",
    ...overrides,
  };
}

describe("productFieldsEqual", () => {
  it("returns true for identical product fields", () => {
    expect(productFieldsEqual(baseProduct, { ...baseProduct })).toBe(true);
  });

  it("returns false when nameSource differs", () => {
    expect(
      productFieldsEqual(baseProduct, { ...baseProduct, nameSource: "Autre" }),
    ).toBe(false);
  });

  it("ignores composition order", () => {
    const a: PfsProductFieldsSnapshot = {
      ...baseProduct,
      composition: [
        { id: "ARGENT", value: 50 },
        { id: "OR", value: 50 },
      ],
    };
    const b: PfsProductFieldsSnapshot = {
      ...baseProduct,
      composition: [
        { id: "OR", value: 50 },
        { id: "ARGENT", value: 50 },
      ],
    };
    expect(productFieldsEqual(a, b)).toBe(true);
  });

  it("returns false when composition values differ", () => {
    const a: PfsProductFieldsSnapshot = {
      ...baseProduct,
      composition: [{ id: "OR", value: 50 }],
    };
    const b: PfsProductFieldsSnapshot = {
      ...baseProduct,
      composition: [{ id: "OR", value: 80 }],
    };
    expect(productFieldsEqual(a, b)).toBe(false);
  });
});

describe("variantSnapshotEqual", () => {
  it("returns true for identical variant snapshots", () => {
    expect(
      variantSnapshotEqual(
        { price: 9.9, stock: 10, weight: 5, isActive: true },
        { price: 9.9, stock: 10, weight: 5, isActive: true },
      ),
    ).toBe(true);
  });

  it("returns false on price change", () => {
    expect(
      variantSnapshotEqual(
        { price: 9.9, stock: 10, weight: 5, isActive: true },
        { price: 11, stock: 10, weight: 5, isActive: true },
      ),
    ).toBe(false);
  });

  it("returns false on isActive change", () => {
    expect(
      variantSnapshotEqual(
        { price: 9.9, stock: 10, weight: 5, isActive: true },
        { price: 9.9, stock: 10, weight: 5, isActive: false },
      ),
    ).toBe(false);
  });
});

describe("diffSnapshots — no previous snapshot", () => {
  it("treats everything as changed when prev is null", () => {
    const next = makeSnapshot();
    const diff = diffSnapshots(null, next);
    expect(diff.productChanged).toBe(true);
    expect(diff.defaultColorChanged).toBe(true);
    expect(diff.statusChanged).toBe(true);
    expect(diff.variantsChanged.sort()).toEqual(["VAR1", "VAR2"]);
    expect(diff.imagesToUpload).toHaveLength(3);
    expect(diff.imagesToDelete).toHaveLength(0);
  });

  it("treats everything as changed when schemaVersion is unknown", () => {
    const next = makeSnapshot();
    const stale = { ...next, schemaVersion: 999 } as unknown as PfsSyncSnapshot;
    const diff = diffSnapshots(stale, next);
    expect(diff.productChanged).toBe(true);
    expect(diff.variantsChanged).toHaveLength(2);
  });
});

describe("diffSnapshots — identical snapshots", () => {
  it("reports no change at all", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot();
    const diff = diffSnapshots(prev, next);
    expect(diff.productChanged).toBe(false);
    expect(diff.defaultColorChanged).toBe(false);
    expect(diff.statusChanged).toBe(false);
    expect(diff.variantsChanged).toEqual([]);
    expect(diff.imagesToUpload).toEqual([]);
    expect(diff.imagesToDelete).toEqual([]);
    expect(diffIsEmpty(diff)).toBe(true);
  });
});

describe("diffSnapshots — single variant change", () => {
  it("reports only the modified variant", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      variants: {
        VAR1: { price: 14, stock: 10, weight: 5, isActive: true }, // prix changé
        VAR2: { price: 12, stock: 0, weight: 6, isActive: false },
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.variantsChanged).toEqual(["VAR1"]);
    expect(diff.productChanged).toBe(false);
    expect(diff.imagesToUpload).toEqual([]);
    expect(diff.imagesToDelete).toEqual([]);
  });

  it("reports a brand-new variant (no prev entry) as changed", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      variants: {
        ...prev.variants,
        VAR3: { price: 7, stock: 5, weight: 3, isActive: true },
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.variantsChanged).toEqual(["VAR3"]);
  });
});

describe("diffSnapshots — image changes", () => {
  it("queues an upload when a new image slot appears", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      images: {
        ...prev.images,
        GOLDEN: { ...prev.images.GOLDEN, "3": "/uploads/products/new.webp" },
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.imagesToUpload).toEqual([
      { colorRef: "GOLDEN", slot: 3, path: "/uploads/products/new.webp" },
    ]);
    expect(diff.imagesToDelete).toEqual([]);
  });

  it("queues a delete when a slot disappears", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      images: {
        ...prev.images,
        GOLDEN: { "1": "/uploads/products/a.webp" }, // slot 2 retiré
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.imagesToDelete).toEqual([{ colorRef: "GOLDEN", slot: 2 }]);
    expect(diff.imagesToUpload).toEqual([]);
  });

  it("queues an upload when a slot's path changes (replacement)", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      images: {
        ...prev.images,
        GOLDEN: {
          "1": "/uploads/products/a-replaced.webp", // path changé
          "2": "/uploads/products/b.webp",
        },
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.imagesToUpload).toEqual([
      { colorRef: "GOLDEN", slot: 1, path: "/uploads/products/a-replaced.webp" },
    ]);
  });

  it("queues delete for an entire color removed", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      images: {
        GOLDEN: prev.images.GOLDEN, // SILVER entièrement retirée
      },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.imagesToDelete).toEqual([{ colorRef: "SILVER", slot: 1 }]);
  });
});

describe("diffSnapshots — product fields & status", () => {
  it("flags productChanged when description changed", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({
      product: { ...prev.product, descSource: "Description modifiée" },
    });
    const diff = diffSnapshots(prev, next);
    expect(diff.productChanged).toBe(true);
    expect(diff.variantsChanged).toEqual([]);
  });

  it("flags statusChanged when status flips to ARCHIVED", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({ status: "ARCHIVED" });
    const diff = diffSnapshots(prev, next);
    expect(diff.statusChanged).toBe(true);
    expect(diff.productChanged).toBe(false);
  });

  it("flags defaultColorChanged when primary color flips", () => {
    const prev = makeSnapshot();
    const next = makeSnapshot({ defaultColor: "SILVER" });
    const diff = diffSnapshots(prev, next);
    expect(diff.defaultColorChanged).toBe(true);
  });
});

describe("diffIsEmpty", () => {
  it("returns true only when nothing changed", () => {
    expect(
      diffIsEmpty({
        productChanged: false,
        defaultColorChanged: false,
        variantsChanged: [],
        imagesToUpload: [],
        imagesToDelete: [],
        statusChanged: false,
      }),
    ).toBe(true);
  });

  it("returns false when any section has work", () => {
    expect(
      diffIsEmpty({
        productChanged: false,
        defaultColorChanged: false,
        variantsChanged: ["X"],
        imagesToUpload: [],
        imagesToDelete: [],
        statusChanged: false,
      }),
    ).toBe(false);
  });
});
