/**
 * Tests pour lib/order-item-image-copy.ts.
 *
 * On exerce le vrai filesystem via un dossier temporaire sous public/ pour
 * vérifier que la copie produit bien un nouveau fichier dans
 * `uploads/{tenant}/commandes/{orderNumber}/` et retourne le chemin BDD attendu.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { copyOrderItemImageToOrderDir } from "@/lib/order-item-image-copy";
import { uploadFile } from "@/lib/storage";

const TEST_ROOT_ABS = path.resolve(process.cwd(), "public", "uploads", "__test_order_copy__");

beforeEach(async () => {
  await fs.rm(TEST_ROOT_ABS, { recursive: true, force: true });
});
afterEach(async () => {
  await fs.rm(TEST_ROOT_ABS, { recursive: true, force: true });
});

// Le test utilise `__test_order_copy__` comme faux tenant slug pour rester
// isolé sous un dossier propre.
const TENANT = "__test_order_copy__";

describe("copyOrderItemImageToOrderDir", () => {
  it("retourne null quand sourceDbPath est null", async () => {
    const result = await copyOrderItemImageToOrderDir({
      sourceDbPath: null,
      orderNumber: "ABC123",
      orderItemId: "item1",
      tenantSlug: TENANT,
    });
    expect(result).toBeNull();
  });

  it("retourne null quand le fichier source n'existe plus (best-effort)", async () => {
    const result = await copyOrderItemImageToOrderDir({
      sourceDbPath: `/uploads/${TENANT}/produits/inconnu/photo.webp`,
      orderNumber: "ABC123",
      orderItemId: "item1",
      tenantSlug: TENANT,
    });
    expect(result).toBeNull();
  });

  it("copie le fichier vers uploads/{tenant}/commandes/{orderNumber}/{itemId}.webp", async () => {
    const srcKey = `uploads/${TENANT}/produits/e310b/e310b-doré-1.webp`;
    await uploadFile(srcKey, Buffer.from("SRC_BYTES"));

    const newPath = await copyOrderItemImageToOrderDir({
      sourceDbPath: `/${srcKey}`,
      orderNumber: "K7X9M2PH",
      orderItemId: "clabcdef123",
      tenantSlug: TENANT,
    });

    expect(newPath).toBe(`/uploads/${TENANT}/commandes/k7x9m2ph/clabcdef123.webp`);

    const destAbs = path.resolve(process.cwd(), "public", newPath!.replace(/^\//, ""));
    const buf = await fs.readFile(destAbs);
    expect(buf.toString()).toBe("SRC_BYTES");
  });

  it("préserve l'extension d'origine (ex. .jpg)", async () => {
    const srcKey = `uploads/${TENANT}/produits/e310b/e310b-doré-1.jpg`;
    await uploadFile(srcKey, Buffer.from("JPEG_BYTES"));

    const newPath = await copyOrderItemImageToOrderDir({
      sourceDbPath: `/${srcKey}`,
      orderNumber: "ORD1",
      orderItemId: "cxyz",
      tenantSlug: TENANT,
    });

    expect(newPath).toBe(`/uploads/${TENANT}/commandes/ord1/cxyz.jpg`);
  });

  it("est idempotent : ne re-copie pas si le chemin est déjà dans commandes/", async () => {
    const alreadyMigrated = `/uploads/${TENANT}/commandes/abc123/item1.webp`;
    const result = await copyOrderItemImageToOrderDir({
      sourceDbPath: alreadyMigrated,
      orderNumber: "ABC123",
      orderItemId: "item1",
      tenantSlug: TENANT,
    });
    expect(result).toBeNull();
  });

  it("laisse la source intacte (copie, pas déplacement)", async () => {
    const srcKey = `uploads/${TENANT}/produits/e310b/e310b-doré-1.webp`;
    await uploadFile(srcKey, Buffer.from("STAY"));

    await copyOrderItemImageToOrderDir({
      sourceDbPath: `/${srcKey}`,
      orderNumber: "ORD2",
      orderItemId: "item2",
      tenantSlug: TENANT,
    });

    const srcAbs = path.resolve(process.cwd(), "public", srcKey);
    const buf = await fs.readFile(srcAbs);
    expect(buf.toString()).toBe("STAY");
  });

  // Sans ces miniatures, la fiche commande affiche une vignette blanche :
  // getImageSrc(src, "thumb") dérive un fichier `-thumb.webp` inexistant → 404.
  // Incident 2026-10-23 — fix crash iOS Safari du 2026-10-22.
  it("copie aussi les variantes -md et -thumb quand elles existent côté source", async () => {
    const base = `uploads/${TENANT}/produits/e310b/e310b-doré-1`;
    await uploadFile(`${base}.webp`, Buffer.from("LARGE"));
    await uploadFile(`${base}-md.webp`, Buffer.from("MEDIUM"));
    await uploadFile(`${base}-thumb.webp`, Buffer.from("THUMB"));

    const newPath = await copyOrderItemImageToOrderDir({
      sourceDbPath: `/${base}.webp`,
      orderNumber: "ORD3",
      orderItemId: "clthumb01",
      tenantSlug: TENANT,
    });

    expect(newPath).toBe(`/uploads/${TENANT}/commandes/ord3/clthumb01.webp`);

    const dir = path.resolve(process.cwd(), "public", "uploads", TENANT, "commandes", "ord3");
    expect((await fs.readFile(path.join(dir, "clthumb01.webp"))).toString()).toBe("LARGE");
    expect((await fs.readFile(path.join(dir, "clthumb01-md.webp"))).toString()).toBe("MEDIUM");
    expect((await fs.readFile(path.join(dir, "clthumb01-thumb.webp"))).toString()).toBe("THUMB");
  });

  it("tolère l'absence des variantes (ancienne image sans -md / -thumb pré-générés)", async () => {
    const srcKey = `uploads/${TENANT}/produits/legacy/photo.webp`;
    await uploadFile(srcKey, Buffer.from("ONLY_LARGE"));

    const newPath = await copyOrderItemImageToOrderDir({
      sourceDbPath: `/${srcKey}`,
      orderNumber: "ORD4",
      orderItemId: "cllegacy1",
      tenantSlug: TENANT,
    });

    expect(newPath).toBe(`/uploads/${TENANT}/commandes/ord4/cllegacy1.webp`);

    const dir = path.resolve(process.cwd(), "public", "uploads", TENANT, "commandes", "ord4");
    expect((await fs.readFile(path.join(dir, "cllegacy1.webp"))).toString()).toBe("ONLY_LARGE");
    await expect(fs.readFile(path.join(dir, "cllegacy1-thumb.webp"))).rejects.toThrow();
    await expect(fs.readFile(path.join(dir, "cllegacy1-md.webp"))).rejects.toThrow();
  });
});
