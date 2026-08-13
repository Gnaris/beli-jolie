/**
 * Script de test — reverse-engineering du back-office Ankorstore.
 *
 * Objectif : valider bout-en-bout la chaîne login → upload image → création produit → archivage,
 * en tapant sur l'API interne du back-office (https://fr.ankorstore.com), pas sur l'API partenaire.
 *
 * Autonome — pas de dépendances au reste du repo. Cookie jar maison, PNG généré à la volée.
 *
 * Usage :
 *   npx tsx scripts/ankorstore-bo-test.ts
 */

import { randomUUID } from "node:crypto";

const BASE_URL = "https://fr.ankorstore.com";
const EMAIL = "beliandjolie@gmail.com";
const PASSWORD = "0951869879Chen";
const DEVICE_ID = `rjs-${randomUUID()}`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------------- Cookie jar minimaliste ----------------

const cookies = new Map<string, string>();

function setCookiesFromResponse(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "" || value === "deleted") cookies.delete(name);
    else cookies.set(name, value);
  }
}

function cookieHeader(): string {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ---------------- Helpers HTTP ----------------

function baseHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    "X-Requested-With": "XMLHttpRequest",
    "X-Device-Id": DEVICE_ID,
  };
}

async function get(path: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { ...baseHeaders(), Cookie: cookieHeader(), ...extraHeaders },
    redirect: "manual",
  });
  setCookiesFromResponse(res);
  return res;
}

async function postJson(
  path: string,
  body: unknown,
  csrf: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      Cookie: cookieHeader(),
      "Content-Type": "application/json",
      "X-Aks-Csrf": csrf,
      "X-Csrf-Token": csrf,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  setCookiesFromResponse(res);
  return res;
}

async function postMultipart(
  path: string,
  form: FormData,
  csrf: string
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      Cookie: cookieHeader(),
      "X-Aks-Csrf": csrf,
      "X-Csrf-Token": csrf,
    },
    body: form,
    redirect: "manual",
  });
  setCookiesFromResponse(res);
  return res;
}

// ---------------- PNG 100x100 unicolore (Blob) ----------------

function makeTestPng(color: [number, number, number] = [200, 40, 60]): Blob {
  const w = 100;
  const h = 100;
  const [r, g, b] = color;

  const scanline = new Uint8Array(w * 3 + 1);
  scanline[0] = 0;
  for (let i = 0; i < w; i++) {
    scanline[1 + i * 3] = r;
    scanline[2 + i * 3] = g;
    scanline[3 + i * 3] = b;
  }
  const raw = new Uint8Array(h * scanline.length);
  for (let y = 0; y < h; y++) raw.set(scanline, y * scanline.length);

  // zlib deflate via Node
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const compressed = zlib.deflateSync(raw);

  function crc32(buf: Uint8Array): number {
    let c = ~0 >>> 0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  }
  function chunk(type: string, data: Uint8Array): Uint8Array {
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
  }

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const dv = new DataView(ihdrData.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type = RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);

  return new Blob([png], { type: "image/png" });
}

// ---------------- Flow ----------------

async function main() {
  const started = Date.now();
  const log = (...args: unknown[]) => console.log(`[${((Date.now() - started) / 1000).toFixed(2)}s]`, ...args);

  // Étape 0 — GET page racine pour poser un cookie session anonyme
  log("Étape 0/6 : GET / pour poser la session anonyme");
  const rootRes = await get("/");
  log("  status", rootRes.status, "cookies", [...cookies.keys()]);

  // Étape 1 — GET /auth/csrf
  log("Étape 1/6 : GET /auth/csrf");
  const csrfRes = await get("/auth/csrf");
  const csrfBody = (await csrfRes.json()) as { csrf?: string };
  const csrf1 = csrfBody.csrf ?? "";
  log("  status", csrfRes.status, "csrf", csrf1 ? csrf1.slice(0, 4) + "…" : "(absent)");
  if (!csrf1) throw new Error("CSRF token vide");

  // Étape 2 — POST /auth/login
  log("Étape 2/6 : POST /auth/login");
  const loginRes = await postJson("/auth/login", { email: EMAIL, password: PASSWORD }, csrf1);
  const loginText = await loginRes.text();
  log("  status", loginRes.status);
  if (loginRes.status !== 200) {
    log("  BODY:", loginText.slice(0, 500));
    throw new Error(`Login failed: ${loginRes.status}`);
  }
  const loginBody = JSON.parse(loginText) as {
    success?: boolean;
    user?: { id?: number; email?: string };
    brand?: { id?: number; name?: string; catalog_integration_uuid?: string };
  };
  const newCsrf = loginRes.headers.get("x-aks-csrf") ?? csrf1;
  log("  success", loginBody.success, "brand", loginBody.brand?.name, "id", loginBody.brand?.id);
  log("  new x-aks-csrf", newCsrf.slice(0, 4) + "…");
  const brandId = loginBody.brand?.id;
  if (!brandId) throw new Error("brand.id manquant dans la réponse login");

  // Étape 3 — Upload une image via POST /api/files
  log("Étape 3/6 : upload PNG test via POST /api/files");
  const pngBlob = makeTestPng([210, 60, 90]);
  const form = new FormData();
  form.append("file", pngBlob, "test-reverse-api.png");
  const uploadRes = await postMultipart("/api/files", form, newCsrf);
  const uploadText = await uploadRes.text();
  log("  status", uploadRes.status);
  if (uploadRes.status !== 200) {
    log("  BODY:", uploadText.slice(0, 500));
    throw new Error(`Upload failed: ${uploadRes.status}`);
  }
  const uploadBody = JSON.parse(uploadText) as { data?: { key?: string; url?: string } };
  const imageKey = uploadBody.data?.key;
  const imageUrl = uploadBody.data?.url;
  log("  key", imageKey);
  log("  url", imageUrl?.slice(0, 80) + "…");
  if (!imageKey) throw new Error("image key absente");

  // Étape 4 — POST /api/me/brand/products
  log("Étape 4/6 : POST /api/me/brand/products (créa produit test)");
  const ts = Date.now();
  const sku = `BJ-TEST-REV-${ts}`;
  const productPayload = {
    name: `Produit TEST reverse API ${ts}`,
    hs_code: "71171900",
    original_description:
      "Produit de test créé par le script de reverse-engineering du back-office Ankorstore. À ignorer / archiver.",
    brand_id: brandId,
    unit_multiplier: 1,
    vat_rate: 20,
    discount_rate: 0,
    retail_price: 300, // 3,00 €
    original_wholesale_price: 100, // 1,00 €
    images: [{ filename: imageKey, order: 0 }],
    options: [
      { id: 2, name: "color", displayName: "Color", values: ["Test"] },
    ],
    categories: [],
    tags: [],
    product_type_id: null,
    attributes: [],
    variants: [
      {
        sku,
        ian: null,
        images: [{ filename: imageKey, order: 0 }],
        stock: { stock_quantity: 1, is_always_in_stock: false, inventory_policy: "continue" },
        shape_properties: {
          capacity: null, capacity_unit: null,
          height: null, length: null, width: null, dimensions_unit: null,
          weight: null, weight_unit: null,
        },
        options: [{ id: 2, name: "color", value: "Test" }],
        price: {
          currency: "EUR",
          original_wholesale_price: { amount: 100 },
          retail_price: { amount: 300 },
          discount_rate: 0,
        },
      },
    ],
    made_in_country_id: 46,
    storage_temperature: null,
    needs_fresh_input: false,
    dimensions: "10x10x1",
    fashion_composition: "100% Test",
  };
  const createRes = await postJson("/api/me/brand/products", productPayload, newCsrf);
  const createText = await createRes.text();
  log("  status", createRes.status);
  if (createRes.status !== 201 && createRes.status !== 200) {
    log("  BODY:", createText.slice(0, 1500));
    throw new Error(`Créa produit failed: ${createRes.status}`);
  }
  const createBody = JSON.parse(createText) as {
    data?: { id?: number; uuid?: string; name?: string; link?: string; active?: boolean; requires_category_update?: boolean };
  };
  const productId = createBody.data?.id;
  log("  productId", productId);
  log("  uuid", createBody.data?.uuid);
  log("  link", createBody.data?.link);
  log("  active", createBody.data?.active, "requires_category_update", createBody.data?.requires_category_update);
  if (!productId) throw new Error("product.id absent après création");

  // Étape 5 — Vérif : le produit apparaît bien dans la liste
  log("Étape 5/5 : vérif — lister le produit par SKU");
  const listRes = await get(
    `/api/me/brand/products?fields=id,name,active&page=1&per_page=10&query=${encodeURIComponent(sku)}&filters[requireupdate]=0&filters[with_options]=1`
  );
  log("  status", listRes.status);
  const listBody = (await listRes.json()) as { meta?: { total?: number }; data?: Array<{ id?: number; name?: string; active?: boolean }> };
  log("  total", listBody.meta?.total, "found", listBody.data?.[0]);

  console.log("\n" + "=".repeat(60));
  console.log("✅ TEST RÉUSSI — produit LAISSÉ EN LIGNE pour inspection");
  console.log("=".repeat(60));
  console.log(`  Brand         : ${loginBody.brand?.name} (id ${brandId})`);
  console.log(`  Produit créé  : id=${productId} sku=${sku}`);
  console.log(`  Nom           : ${createBody.data?.name}`);
  console.log(`  Image URL     : ${imageUrl}`);
  console.log(`  Lien back-off : https://fr.ankorstore.com${createBody.data?.link ?? ""}`);
  console.log(`  État          : active=${createBody.data?.active}, requires_category_update=${createBody.data?.requires_category_update}`);
  console.log(`  Visible liste : ${listBody.meta?.total} résultat(s)`);
  console.log(`  Durée totale  : ${((Date.now() - started) / 1000).toFixed(2)}s`);
  console.log("\n  ⚠️  Pense à l'archiver manuellement quand tu as fini de l'inspecter.");
}

main().catch((err) => {
  console.error("\n❌ ÉCHEC :", err);
  process.exit(1);
});
