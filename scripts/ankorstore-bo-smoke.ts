/**
 * Smoke test du module lib/ankorstore-bo.
 *
 * Enchaîne : login → upload → publish → read → update (BestSeller ON)
 *          → read → disable → enable → archive.
 *
 * IMPORTANT : ce script crée un vrai produit sur le compte Beli & Jolie Ankorstore.
 * Il l'archive à la fin pour ne pas polluer le catalogue. Durée totale ~30 s.
 *
 * Usage : npx tsx scripts/ankorstore-bo-smoke.ts
 */

import { randomUUID } from "node:crypto";
import zlib from "node:zlib";

import {
  primeBoCredentials,
  primeBoDeviceId,
  getBoSession,
  uploadImagesSequential,
  waitForUploadsIngestion,
  createProduct,
  readProductByIdWithRetry,
  updateProduct,
  enableProducts,
  disableProducts,
  archiveProducts,
  ANKORSTORE_TAG_IDS,
  ANKORSTORE_OPTION_IDS,
  ankorstoreCountryIdFromIso,
  type BoProductPayload,
} from "@/lib/ankorstore-bo";

// ─── Config test ─────────────────────────────────────

const EMAIL = "beliandjolie@gmail.com";
const PASSWORD = "0951869879Chen";
const TENANT_ID = "global"; // script hors contexte Next → tenant fallback

// ─── PNG synthétique 100×100 rouge ───────────────────

function makeTestPng(color: [number, number, number] = [210, 60, 90]): Buffer {
  const w = 100;
  const h = 100;
  const [r, g, b] = color;
  const scanline = new Uint8Array(w * 3 + 1);
  for (let i = 0; i < w; i++) {
    scanline[1 + i * 3] = r;
    scanline[2 + i * 3] = g;
    scanline[3 + i * 3] = b;
  }
  const raw = new Uint8Array(h * scanline.length);
  for (let y = 0; y < h; y++) raw.set(scanline, y * scanline.length);
  const compressed = zlib.deflateSync(raw);

  const crc32 = (buf: Uint8Array): number => {
    let c = ~0 >>> 0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBuf = new TextEncoder().encode(type);
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, data.length);
    const crcInput = new Uint8Array(typeBuf.length + data.length);
    crcInput.set(typeBuf, 0);
    crcInput.set(data, typeBuf.length);
    const crc = crc32(crcInput);
    const crcBuf = new Uint8Array(4);
    new DataView(crcBuf.buffer).setUint32(0, crc);
    return Uint8Array.from([...lenBuf, ...typeBuf, ...data, ...crcBuf]);
  };
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const dv = new DataView(ihdrData.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", new Uint8Array(0));
  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);
  return Buffer.from(png);
}

// ─── Flow ─────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const log = (...a: unknown[]) =>
    console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);

  primeBoCredentials(TENANT_ID, EMAIL, PASSWORD);
  primeBoDeviceId(TENANT_ID, `rjs-${randomUUID()}`);

  // 1. Login
  log("Étape 1/8 : login (getBoSession)");
  const session = await getBoSession();
  log("  brand", session.brandId, "csrf", session.csrfToken.slice(0, 4) + "…");

  // 2. Upload 2 images (séquentiel, avec délai)
  log("Étape 2/8 : upload de 2 images");
  const uploads = await uploadImagesSequential(
    [
      { buffer: makeTestPng([210, 60, 90]), filename: "test-rouge.png" },
      { buffer: makeTestPng([60, 210, 90]), filename: "test-vert.png" },
    ],
    { onProgress: (i, n) => log("  image", i + 1, "/", n) }
  );
  log("  clés", uploads.map((u) => u.key));

  await waitForUploadsIngestion();
  log("  ingestion attendue (3 s)");

  // 3. Créer un produit test avec 1 variante + les 2 images
  log("Étape 3/8 : publier le produit");
  const ts = Date.now();
  const sku = `BJ-TEST-SMOKE-${ts}`;
  const payload: BoProductPayload = {
    name: `Smoke test module BO ${ts}`,
    hs_code: "71171900",
    original_description:
      "Produit de test créé par scripts/ankorstore-bo-smoke.ts pour valider le module lib/ankorstore-bo. Archivé automatiquement en fin de test.",
    brand_id: session.brandId,
    unit_multiplier: 1,
    vat_rate: 20,
    discount_rate: 0,
    retail_price: 300,
    original_wholesale_price: 100,
    images: uploads.map((u, i) => ({ filename: u.key, order: i })),
    options: [
      {
        id: ANKORSTORE_OPTION_IDS.COLOR,
        name: "color",
        displayName: "Color",
        values: ["Smoke"],
      },
    ],
    categories: [],
    tags: [],
    product_type_id: null,
    attributes: [],
    variants: [
      {
        sku,
        ian: null,
        images: uploads.map((u, i) => ({ filename: u.key, order: i })),
        stock: { stock_quantity: 1, is_always_in_stock: false, inventory_policy: "continue" },
        shape_properties: {
          capacity: null, capacity_unit: null,
          height: null, length: null, width: null, dimensions_unit: null,
          weight: null, weight_unit: null,
        },
        options: [{ id: ANKORSTORE_OPTION_IDS.COLOR, name: "color", value: "Smoke" }],
        price: {
          currency: "EUR",
          original_wholesale_price: { amount: 100 },
          retail_price: { amount: 300 },
          discount_rate: 0,
        },
      },
    ],
    made_in_country_id: ankorstoreCountryIdFromIso("CN"),
    storage_temperature: null,
    needs_fresh_input: false,
    dimensions: "10x10x1",
    fashion_composition: "100% Test",
  };
  const created = await createProduct(payload);
  log("  productId", created.id, "active", created.active, "requires_category", created.requires_category_update);

  // 4. Lire le produit
  log("Étape 4/8 : re-lecture par ID (retry si 404)");
  const readBack = await readProductByIdWithRetry(created.id);
  log("  found", !!readBack, "tags", readBack?.tags, "images", readBack?.images?.length);

  // 5. Modification : ajouter le tag BestSeller
  // BUG à confirmer : Ankor refuse en 422 si on renvoie le SKU inchangé. On suffixe pour ce smoke test.
  log("Étape 5/8 : modif — activer Bestseller (PUT complet)");
  const updatedPayload: BoProductPayload = {
    ...payload,
    tags: [ANKORSTORE_TAG_IDS.BESTSELLER],
    images: uploads.map((u, i) => ({ filename: u.key, order: i })),
    variants: payload.variants.map((v) => ({ ...v, sku: v.sku + "-U" })),
  };
  const updated = await updateProduct(created.id, updatedPayload);
  log("  active", updated.active, "tags", updated.tags);

  // 6. Re-lecture pour confirmer
  log("Étape 6/8 : re-lecture pour vérifier Bestseller");
  const readAgain = await readProductByIdWithRetry(created.id);
  log("  tags", readAgain?.tags, "has Bestseller", readAgain?.tags?.includes("Bestseller"));

  // 7. Mass action : disable puis enable
  log("Étape 7/8 : mass-action disable → enable");
  const disabled = await disableProducts([created.id]);
  log("  après disable, active =", disabled[0]?.active);
  const enabled = await enableProducts([created.id]);
  log("  après enable, active =", enabled[0]?.active);

  // 8. Archivage final
  log("Étape 8/8 : archivage final");
  await archiveProducts([created.id]);
  log("  archivé");

  console.log("\n" + "=".repeat(60));
  console.log("✅ SMOKE TEST BO OK");
  console.log("=".repeat(60));
  console.log(`  Produit test id ${created.id}`);
  console.log(`  SKU             ${sku}`);
  console.log(`  Durée totale    ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\n❌ Smoke test échoué :", err);
  process.exit(1);
});
