/**
 * Tests for the new storage helpers in `lib/storage.ts`.
 *
 * Covers:
 *   - `slugify` — accent retention, illegal char stripping, edge cases
 *   - `productImageDir` / `productImageBaseName`
 *   - `collectionImageDir`, `kbisDir`, `invoiceDir`, `claimDir`,
 *     `bordereauDir`
 *   - `renameProductFolder` — no-op, single file, multiple files, same name
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  slugify,
  productImageDir,
  productImageBaseName,
  collectionImageDir,
  categoryImageDir,
  kbisDir,
  clientDocumentsDir,
  invoiceDir,
  claimDir,
  bordereauDir,
  renameProductFolder,
  substituteReferenceInPath,
  substituteReferenceInDestDir,
} from "@/lib/storage";

describe("lib/storage — slugify", () => {
  it("lowercases and trims", () => {
    expect(slugify("  Hello WORLD  ")).toBe("hello-world");
  });

  it("replaces whitespace with single dash", () => {
    expect(slugify("foo   bar  baz")).toBe("foo-bar-baz");
  });

  it("collapses repeated dashes", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("strips accents (URL compat marketplaces — Orderchamp rejette %C3%A9)", () => {
    expect(slugify("Doré")).toBe("dore");
    expect(slugify("Été 2026")).toBe("ete-2026");
    expect(slugify("Ça va")).toBe("ca-va");
    expect(slugify("Naïve")).toBe("naive");
  });

  it("strips Windows-illegal characters", () => {
    expect(slugify('a\\b/c:d*e?f"g<h>i|j')).toBe("abcdefghij");
  });

  it("strips ASCII control chars and null bytes", () => {
    expect(slugify("foo\x00bar\x01baz")).toBe("foobarbaz");
  });

  it("trims leading/trailing dashes and dots", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("...hello...")).toBe("hello");
    expect(slugify(".-hello-.")).toBe("hello");
  });

  it("returns 'sans-nom' for empty / null / fully stripped input", () => {
    expect(slugify("")).toBe("sans-nom");
    expect(slugify("   ")).toBe("sans-nom");
    expect(slugify("***")).toBe("sans-nom");
    // @ts-expect-error testing null input
    expect(slugify(null)).toBe("sans-nom");
  });

  it("handles multi-color labels (Brun + Kaki)", () => {
    expect(slugify("Brun + Kaki")).toBe("brun-+-kaki");
  });

  it("converts (N) duplicate suffix to _N (Orderchamp URL compat)", () => {
    // Référence type `A2251(2)` = doublon BJ. Orderchamp rejette les
    // parenthèses non-encodées comme « Invalid attachment ». Doit être
    // rendu comme `a2251_2` dans le path fichier.
    expect(slugify("A2251(2)")).toBe("a2251_2");
    expect(slugify("REF-42(3)")).toBe("ref-42_3");
    expect(slugify("A(10)")).toBe("a_10");
  });

  it("converts orphan parentheses to _ (defensive fallback)", () => {
    // Parenthèses sans chiffre à l'intérieur : remplacées par `_`.
    expect(slugify("A(B)C")).toBe("a_b_c");
    expect(slugify("test(abc)")).toBe("test_abc_");
  });

  it("productImageDir strips parentheses from reference", () => {
    expect(productImageDir("A2251(2)")).toBe("uploads/produits/a2251_2");
  });

  it("productImageBaseName strips parentheses from reference", () => {
    expect(productImageBaseName("A2251(2)", "Doré", 1)).toBe("a2251_2-dore-1");
  });
});

describe("lib/storage — path helpers", () => {
  it("productImageDir slugifies the reference", () => {
    expect(productImageDir("E310B")).toBe("uploads/produits/e310b");
    expect(productImageDir("ref 123")).toBe("uploads/produits/ref-123");
  });

  it("productImageBaseName with color → ref-color-n (accents strippés)", () => {
    expect(productImageBaseName("E310B", "Doré", 1)).toBe("e310b-dore-1");
    expect(productImageBaseName("REF-123", "Bleu Roi", 3)).toBe("ref-123-bleu-roi-3");
  });

  it("productImageBaseName without color → ref-n", () => {
    expect(productImageBaseName("E310B", null, 1)).toBe("e310b-1");
    expect(productImageBaseName("E310B", "", 2)).toBe("e310b-2");
    expect(productImageBaseName("E310B", "  ", 4)).toBe("e310b-4");
  });

  it("productImageBaseName clamps non-positive index to 1", () => {
    expect(productImageBaseName("E310B", "Doré", 0)).toBe("e310b-dore-1");
    expect(productImageBaseName("E310B", null, -3)).toBe("e310b-1");
  });

  it("collectionImageDir uses slug (accents strippés)", () => {
    expect(collectionImageDir("Été 2026")).toBe("uploads/collections/ete-2026");
  });

  it("categoryImageDir uses id (multi-tenant scoping)", () => {
    expect(categoryImageDir("clx123abc")).toBe("uploads/categories/clx123abc");
    expect(categoryImageDir("clx123abc", "beliandjolie")).toBe(
      "uploads/beliandjolie/categories/clx123abc",
    );
  });

  it("kbisDir / clientDocumentsDir live under private/", () => {
    expect(kbisDir("user-123")).toBe("private/uploads/kbis/user-123");
    expect(clientDocumentsDir("user-123")).toBe("private/uploads/documents/user-123");
  });

  it("invoiceDir groups by year", () => {
    expect(invoiceDir(2026)).toBe("private/uploads/factures/2026");
  });

  it("claimDir uses commande-{ref} (PUBLIC for direct <img> rendering)", () => {
    expect(claimDir("ABC-123")).toBe("uploads/reclamations/commande-abc-123");
  });

  it("bordereauDir uses client id", () => {
    expect(bordereauDir("client-42")).toBe("uploads/bordereaux/client-42");
  });
});

describe("lib/storage — substituteReferenceInPath", () => {
  it("replaces the folder slug AND the basename prefix in one shot", () => {
    // Cas nominal : upload async terminé APRÈS rename produit A2251(2) → A2251(3).
    // Le path BDD contient encore l'ancien slug côté dossier ET côté basename.
    expect(
      substituteReferenceInPath(
        "/uploads/beliandjolie/produits/a2251_2/a2251_2-doré-1-msxb0q5b9q0d.webp",
        "a2251_2",
        "a2251_3",
        "beliandjolie",
      ),
    ).toBe("/uploads/beliandjolie/produits/a2251_3/a2251_3-doré-1-msxb0q5b9q0d.webp");
  });

  it("only replaces the folder if the basename does not start with the old slug", () => {
    // Path bizarre où le fichier a un nom manuel (pas préfixé par le slug).
    expect(
      substituteReferenceInPath(
        "/uploads/beliandjolie/produits/a2251_2/manual-photo.jpg",
        "a2251_2",
        "a2251_3",
        "beliandjolie",
      ),
    ).toBe("/uploads/beliandjolie/produits/a2251_3/manual-photo.jpg");
  });

  it("returns the path unchanged if the old slug is not present", () => {
    expect(
      substituteReferenceInPath(
        "/uploads/beliandjolie/produits/xyz/xyz-1.webp",
        "a2251_2",
        "a2251_3",
        "beliandjolie",
      ),
    ).toBe("/uploads/beliandjolie/produits/xyz/xyz-1.webp");
  });

  it("no-op if oldSlug === newSlug", () => {
    expect(
      substituteReferenceInPath(
        "/uploads/beliandjolie/produits/xyz/xyz-1.webp",
        "xyz",
        "xyz",
        "beliandjolie",
      ),
    ).toBe("/uploads/beliandjolie/produits/xyz/xyz-1.webp");
  });

  it("works with tenant slug in the middle of the path (multi-tenant)", () => {
    expect(
      substituteReferenceInPath(
        "/uploads/issyma/produits/z178_2/z178_2-vert-3-abc.webp",
        "z178_2",
        "z178_3",
        "issyma",
      ),
    ).toBe("/uploads/issyma/produits/z178_3/z178_3-vert-3-abc.webp");
  });
});

describe("lib/storage — substituteReferenceInDestDir", () => {
  it("replaces slug at the end of destDir (no trailing slash)", () => {
    expect(
      substituteReferenceInDestDir("uploads/beliandjolie/produits/a2251_2", "a2251_2", "a2251_3"),
    ).toBe("uploads/beliandjolie/produits/a2251_3");
  });

  it("replaces slug when followed by a trailing slash or subpath", () => {
    expect(
      substituteReferenceInDestDir("uploads/beliandjolie/produits/a2251_2/", "a2251_2", "a2251_3"),
    ).toBe("uploads/beliandjolie/produits/a2251_3/");
  });

  it("does not match if the slug is a prefix of a longer folder name", () => {
    // Boundary check : a2251_2 ne doit pas matcher dans "a2251_20"
    expect(
      substituteReferenceInDestDir("uploads/beliandjolie/produits/a2251_20", "a2251_2", "a2251_3"),
    ).toBe("uploads/beliandjolie/produits/a2251_20");
  });

  it("no-op if oldSlug === newSlug", () => {
    expect(
      substituteReferenceInDestDir("uploads/beliandjolie/produits/xyz", "xyz", "xyz"),
    ).toBe("uploads/beliandjolie/produits/xyz");
  });

  it("returns destDir unchanged if the slug is not present", () => {
    expect(
      substituteReferenceInDestDir("uploads/beliandjolie/produits/xyz", "a2251_2", "a2251_3"),
    ).toBe("uploads/beliandjolie/produits/xyz");
  });
});

describe("lib/storage — renameProductFolder", () => {
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    await fs.mkdir(path.join(tmpDir, "public"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "private"), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeProductFile(slug: string, name: string, content = "x"): Promise<void> {
    const dir = path.join(tmpDir, "public", "uploads", "produits", slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), content);
  }

  async function dirContents(slug: string): Promise<string[]> {
    try {
      return (await fs.readdir(path.join(tmpDir, "public", "uploads", "produits", slug))).sort();
    } catch {
      return [];
    }
  }

  async function dirExists(slug: string): Promise<boolean> {
    try {
      await fs.stat(path.join(tmpDir, "public", "uploads", "produits", slug));
      return true;
    } catch {
      return false;
    }
  }

  it("is a no-op when the folder does not exist (product without images)", async () => {
    const res = await renameProductFolder("OLD", "NEW");
    expect(res.renamed).toEqual([]);
    expect(await dirExists("old")).toBe(false);
    expect(await dirExists("new")).toBe(false);
  });

  it("is a no-op when the slugified old/new are identical", async () => {
    await writeProductFile("e310b", "e310b-doré-1.webp");
    const res = await renameProductFolder("E310B", "e310b");
    expect(res.renamed).toEqual([]);
    expect(await dirExists("e310b")).toBe(true);
    expect(await dirContents("e310b")).toEqual(["e310b-doré-1.webp"]);
  });

  it("renames a folder with a single file", async () => {
    await writeProductFile("oldref", "oldref-doré-1.webp");
    const res = await renameProductFolder("OLDREF", "NEWREF");

    expect(await dirExists("oldref")).toBe(false);
    expect(await dirExists("newref")).toBe(true);
    expect(await dirContents("newref")).toEqual(["newref-doré-1.webp"]);

    expect(res.renamed).toHaveLength(1);
    expect(res.renamed[0].oldDbPath).toBe("/uploads/produits/oldref/oldref-doré-1.webp");
    expect(res.renamed[0].newDbPath).toBe("/uploads/produits/newref/newref-doré-1.webp");
  });

  it("renames every file with the old prefix and reports DB swaps", async () => {
    await writeProductFile("e310b", "e310b-doré-1.webp");
    await writeProductFile("e310b", "e310b-doré-1-md.webp");
    await writeProductFile("e310b", "e310b-doré-1-thumb.webp");
    await writeProductFile("e310b", "e310b-bleu-2.webp");

    const res = await renameProductFolder("E310B", "F999");

    expect(await dirExists("e310b")).toBe(false);
    expect(await dirExists("f999")).toBe(true);
    expect(await dirContents("f999")).toEqual([
      "f999-bleu-2.webp",
      "f999-doré-1-md.webp",
      "f999-doré-1-thumb.webp",
      "f999-doré-1.webp",
    ]);

    // 4 files renamed
    expect(res.renamed).toHaveLength(4);
    const oldPaths = res.renamed.map((r) => r.oldDbPath).sort();
    const newPaths = res.renamed.map((r) => r.newDbPath).sort();
    expect(oldPaths).toEqual([
      "/uploads/produits/e310b/e310b-bleu-2.webp",
      "/uploads/produits/e310b/e310b-doré-1-md.webp",
      "/uploads/produits/e310b/e310b-doré-1-thumb.webp",
      "/uploads/produits/e310b/e310b-doré-1.webp",
    ]);
    expect(newPaths).toEqual([
      "/uploads/produits/f999/f999-bleu-2.webp",
      "/uploads/produits/f999/f999-doré-1-md.webp",
      "/uploads/produits/f999/f999-doré-1-thumb.webp",
      "/uploads/produits/f999/f999-doré-1.webp",
    ]);
  });

  it("leaves files whose names don't match the old prefix untouched", async () => {
    await writeProductFile("e310b", "e310b-doré-1.webp");
    await writeProductFile("e310b", "manual-photo.jpg"); // unrelated

    await renameProductFolder("E310B", "F999");

    const contents = await dirContents("f999");
    expect(contents).toContain("f999-doré-1.webp");
    expect(contents).toContain("manual-photo.jpg"); // preserved as-is
  });
});
