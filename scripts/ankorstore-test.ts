/**
 * Script de test Ankorstore — création / inspection / archivage variante / suppression
 *
 * Usage :
 *   npx tsx scripts/ankorstore-test.ts create
 *     → crée un produit factice "TEST À SUPPRIMER" avec 2 variantes
 *   npx tsx scripts/ankorstore-test.ts inspect
 *     → affiche l'état actuel du produit et de ses variantes
 *   npx tsx scripts/ankorstore-test.ts archive-variant <variantId>
 *     → tente PATCH archived=true, repli sur stock=0 si refusé
 *   npx tsx scripts/ankorstore-test.ts delete-product
 *     → supprime le produit factice sur Ankorstore
 *   npx tsx scripts/ankorstore-test.ts clean
 *     → supprime le fichier d'état local (sans toucher à Ankorstore)
 *
 * L'identifiant du produit créé est stocké dans `scripts/.ankorstore-test-state.json`
 * (gitignored) pour pouvoir enchaîner les étapes.
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const STATE_FILE = path.join(__dirname, ".ankorstore-test-state.json");

interface TestState {
  ankorstoreProductId?: string;
  externalId?: string;
  variantIds?: string[];
}

interface CatalogResultItem {
  externalProductId?: string;
  ankorstoreProductId?: string | null;
  status: string;
  failureReason?: string | null;
  issues?: unknown[];
}

interface VariantInfo {
  id: string;
  sku: string | null;
  name: string | null;
  archived: boolean | null;
  stockQuantity: number | null;
  availableQuantity: number | null;
}

// ────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────

async function getCreds(): Promise<{ clientId: string; clientSecret: string }> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? ""]),
  );
  const clientId = map.get("ankors_client_id") ?? "";
  const clientSecret = map.get("ankors_client_secret") ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants en BDD (ankors_client_id / ankors_client_secret).");
  }
  return { clientId, clientSecret };
}

async function getToken(): Promise<string> {
  const { clientId, clientSecret } = await getCreds();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ankorstore auth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in response.");
  return data.access_token as string;
}

// ────────────────────────────────────────────────
// Generic API helper
// ────────────────────────────────────────────────

async function api<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  pathname: string,
  body: object | undefined,
  token: string,
): Promise<T> {
  const res = await fetch(`${ANKORSTORE_BASE_URL}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.api+json",
      ...(body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// ────────────────────────────────────────────────
// State persistence
// ────────────────────────────────────────────────

function loadState(): TestState {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as TestState;
}

function saveState(state: TestState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ────────────────────────────────────────────────
// Catalog operation helpers
// ────────────────────────────────────────────────

async function pollOperation(
  operationId: string,
  token: string,
): Promise<CatalogResultItem[]> {
  const deadline = Date.now() + 180_000;
  let lastStatus: string | null = null;
  while (Date.now() < deadline) {
    const statusResp = await api<{ data: { attributes: Record<string, unknown> } }>(
      "GET",
      `/catalog/integrations/operations/${encodeURIComponent(operationId)}`,
      undefined,
      token,
    );
    const status = statusResp.data.attributes.status as string;
    if (status !== lastStatus) {
      const elapsed = Math.floor((180_000 - (deadline - Date.now())) / 1000);
      console.log(`    [${elapsed}s] statut = ${status}`);
      console.log(`         attributs complets : ${JSON.stringify(statusResp.data.attributes)}`);
      lastStatus = status;
    }
    if (["succeeded", "partially_failed", "failed", "skipped"].includes(status)) {
      const resultsResp = await api<{
        data: { attributes: CatalogResultItem }[];
      }>(
        "GET",
        `/catalog/integrations/operations/${encodeURIComponent(operationId)}/results`,
        undefined,
        token,
      );
      return resultsResp.data.map((d) => d.attributes);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timeout (180s) — dernier statut connu : ${lastStatus} — opération ${operationId}`);
}

async function fetchProductWithVariants(
  productId: string,
  token: string,
): Promise<{ product: Record<string, unknown>; variants: VariantInfo[] }> {
  // Spec officielle : include=productVariants (au pluriel) pour /products/{id}
  const resp = await api<{
    data: {
      attributes: Record<string, unknown>;
      relationships?: { productVariants?: { data: { id: string }[] } };
    };
    included?: { id: string; attributes: Record<string, unknown> }[];
  }>(
    "GET",
    `/products/${encodeURIComponent(productId)}?include=productVariants`,
    undefined,
    token,
  );

  const variantIds = resp.data.relationships?.productVariants?.data?.map((v) => v.id) ?? [];
  const variants: VariantInfo[] = variantIds.map((id) => {
    const v = (resp.included ?? []).find((x) => x.id === id);
    const attr = v?.attributes ?? {};
    return {
      id,
      sku: (attr.sku as string | undefined) ?? null,
      name: (attr.name as string | undefined) ?? null,
      archived: (attr.archived as boolean | undefined) ?? null,
      stockQuantity: (attr.stockQuantity as number | undefined) ?? null,
      availableQuantity: (attr.availableQuantity as number | undefined) ?? null,
    };
  });

  return { product: resp.data.attributes, variants };
}

// ────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────

async function createOperation(
  token: string,
  operationType: "import" | "update" | "delete",
): Promise<string> {
  // API Ankorstore (constatée en 2026-05) :
  //   - attribute s'appelle `operationType` (camelCase), pas `type`
  //   - `callbackUrl` est obligatoire (on met une URL bidon, on poll nous-même)
  const r = await api<{ data: { id: string } }>(
    "POST",
    "/catalog/integrations/operations",
    {
      data: {
        type: "catalog-integration-operation",
        attributes: {
          operationType,
          source: "other",
          callbackUrl: "https://example.com/ankorstore-test-callback",
        },
      },
    },
    token,
  );
  return r.data.id;
}

async function cmdCreate(): Promise<void> {
  const token = await getToken();
  const stamp = Date.now();
  const externalId = `TEST-DELETE-${stamp}`;

  console.log("⌛ Création de l'opération d'import…");
  const operationId = await createOperation(token, "import");

  console.log("⌛ Ajout du produit factice…");
  // Spec officielle Ankorstore (2026-05) :
  //   - wrapper top-level = `products: [...]`, PAS `data: [...]`
  //   - attributs en snake_case (external_id, vat_rate, made_in_country, …)
  const addResp = await api<{ meta?: { totalProductsCount?: number } }>(
    "POST",
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}/products`,
    {
      products: [
        {
          id: externalId,
          type: "catalog-integration-product",
          attributes: {
            external_id: externalId,
            name: "TEST À SUPPRIMER — produit factice de test API",
            description:
              "Ce produit existe uniquement pour tester l'intégration API. Il sera supprimé automatiquement. Ne pas commander.",
            currency: "EUR",
            vat_rate: 20,
            unit_multiplier: 1,
            wholesale_price: 10,
            retail_price: 20,
            made_in_country: "FR",
            main_image: "https://picsum.photos/seed/ankorstore-test/600/600",
            images: [
              { order: 1, url: "https://picsum.photos/seed/ankorstore-test/600/600" },
            ],
            variants: [
              {
                sku: `${externalId}_ROUGE_M`,
                stock_quantity: 5,
                is_always_in_stock: false,
                wholesale_price: 10,
                retail_price: 20,
                original_wholesale_price: 10,
                options: [
                  { name: "color", value: "Rouge" },
                  { name: "size", value: "M" },
                ],
              },
              {
                sku: `${externalId}_BLEU_M`,
                stock_quantity: 5,
                is_always_in_stock: false,
                wholesale_price: 10,
                retail_price: 20,
                original_wholesale_price: 10,
                options: [
                  { name: "color", value: "Bleu" },
                  { name: "size", value: "M" },
                ],
              },
            ],
          },
        },
      ],
    },
    token,
  );
  console.log(`    totalProductsCount après POST : ${addResp.meta?.totalProductsCount ?? "?"}`);

  console.log("⌛ Lancement de l'opération…");
  await api(
    "PATCH",
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}`,
    {
      data: {
        type: "catalog-integration-operation",
        id: operationId,
        attributes: { status: "started" },
      },
    },
    token,
  );

  console.log("⌛ Polling jusqu'à la fin de l'opération…");
  const results = await pollOperation(operationId, token);
  const result = results[0];
  if (!result || result.status !== "success") {
    console.error("❌ Création échouée :", result?.failureReason ?? "(no reason)");
    console.error("   issues :", JSON.stringify(result?.issues ?? [], null, 2));
    process.exit(1);
  }

  // L'API ne renvoie pas le ankorstoreProductId dans /results — on le retrouve
  // en filtrant les variantes par SKU (chaque variante porte la relation product).
  // Petit délai pour laisser le temps à Ankorstore d'indexer.
  console.log("⌛ Récupération de l'id Ankorstore via le SKU de la 1ʳᵉ variante…");
  const firstSku = `${externalId}_ROUGE_M`;
  let ankorstoreProductId = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? 3000 : 5000));
    const variantsByFilter = await api<{
      data: {
        id: string;
        attributes: Record<string, unknown>;
        relationships?: { product?: { data?: { id?: string } } };
      }[];
    }>(
      "GET",
      `/product-variants?filter[sku]=${encodeURIComponent(firstSku)}&include=product`,
      undefined,
      token,
    );
    ankorstoreProductId = variantsByFilter.data[0]?.relationships?.product?.data?.id ?? "";
    if (ankorstoreProductId) break;
    console.log(`    tentative ${attempt}/6 : pas encore indexé, on réessaye…`);
  }
  if (!ankorstoreProductId) {
    console.error(`❌ Impossible de retrouver le produit créé via le SKU "${firstSku}" après 6 tentatives.`);
    process.exit(1);
  }
  console.log(`✔ Produit créé sur Ankorstore — id : ${ankorstoreProductId}`);
  // On sauve l'état dès maintenant pour ne pas le perdre si la suite échoue.
  saveState({ ankorstoreProductId, externalId, variantIds: [] });

  console.log("⌛ Récupération de toutes les variantes du produit…");
  let variants: VariantInfo[] = [];
  try {
    const fetched = await fetchProductWithVariants(ankorstoreProductId, token);
    variants = fetched.variants;
    saveState({
      ankorstoreProductId,
      externalId,
      variantIds: variants.map((v) => v.id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`    ⚠ Lecture variantes échouée (non bloquant) : ${msg.slice(0, 200)}`);
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("✔ Produit factice créé sur votre compte Ankorstore.");
  console.log("");
  console.log(`  external_id          : ${externalId}`);
  console.log(`  ankorstoreProductId  : ${ankorstoreProductId}`);
  console.log("  variantes            :");
  for (const v of variants) {
    console.log(`    • ${v.id}  sku=${v.sku}  archived=${v.archived}  stock=${v.stockQuantity ?? v.availableQuantity}`);
  }
  console.log("");
  console.log("→ Connectez-vous sur https://www.ankorstore.com/brand-dashboard");
  console.log("  pour vérifier que le produit « TEST À SUPPRIMER » est bien visible.");
  console.log("═══════════════════════════════════════════════════");
}

async function cmdInspect(): Promise<void> {
  const state = loadState();
  if (!state.ankorstoreProductId) {
    console.log("Aucun produit de test enregistré. Lance d'abord `create`.");
    return;
  }
  const token = await getToken();
  try {
    const { product, variants } = await fetchProductWithVariants(
      state.ankorstoreProductId,
      token,
    );
    console.log(`📦 Produit : ${state.ankorstoreProductId}`);
    console.log(`   active=${product.active}  archived=${product.archived}`);
    console.log("📋 Variantes :");
    for (const v of variants) {
      console.log(
        `   • ${v.id}  sku=${v.sku}  archived=${v.archived}  stockQty=${v.stockQuantity}  availableQty=${v.availableQuantity}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) {
      console.log("→ Produit introuvable côté Ankorstore (supprimé ou jamais créé).");
    } else {
      throw err;
    }
  }
}

async function cmdDeleteVariant(skuArg: string | undefined): Promise<void> {
  const state = loadState();
  if (!state.externalId) {
    console.log("Aucun produit de test enregistré. Lance d'abord `create`.");
    return;
  }

  // Si aucun SKU précisé : on prend la 1ʳᵉ variante du produit de test
  let sku = skuArg;
  if (!sku) {
    const token0 = await getToken();
    const { variants } = await fetchProductWithVariants(state.ankorstoreProductId!, token0);
    sku = variants[0]?.sku ?? undefined;
    if (!sku) {
      console.log("Aucune variante avec SKU trouvée sur le produit de test.");
      return;
    }
    console.log(`(Pas de SKU fourni → on supprime la 1ʳᵉ variante : sku=${sku})`);
  }

  const token = await getToken();
  console.log(`⌛ POST /catalog/integrations/operations/delete avec variants=[{sku: "${sku}"}]…`);

  const resp = await api<{ data: { id: string } }>(
    "POST",
    "/catalog/integrations/operations/delete",
    {
      source: "other",
      callbackUrl: "https://example.com/ankorstore-test-callback",
      products: [
        {
          type: "catalog-integration-product",
          attributes: {
            external_id: state.externalId,
            variants: [{ sku }],
          },
        },
      ],
    },
    token,
  );

  const operationId = resp.data.id;
  console.log(`  → opérationId : ${operationId} (démarrage automatique)`);
  console.log("⌛ Polling…");
  const results = await pollOperation(operationId, token);
  console.log("✔ Résultat suppression variante :", JSON.stringify(results, null, 2));
}

async function cmdDeleteProduct(): Promise<void> {
  const state = loadState();
  if (!state.externalId || !state.ankorstoreProductId) {
    console.log("Aucun produit de test enregistré. Lance d'abord `create`.");
    return;
  }

  const token = await getToken();

  // 1ʳᵉ tentative : lister explicitement toutes les variantes du produit
  // dans le payload de suppression (la spec montre l'exemple avec variants[])
  console.log("⌛ Récupération des SKU actuels du produit…");
  const { variants } = await fetchProductWithVariants(state.ankorstoreProductId, token);
  const skus = variants.map((v) => v.sku).filter((s): s is string => !!s);
  console.log(`    SKU à supprimer : ${skus.join(", ")}`);

  console.log(`⌛ Suppression du produit ${state.externalId} avec liste complète des variantes…`);
  const resp = await api<{ data: { id: string } }>(
    "POST",
    "/catalog/integrations/operations/delete",
    {
      source: "other",
      callbackUrl: "https://example.com/ankorstore-test-callback",
      products: [
        {
          type: "catalog-integration-product",
          attributes: {
            external_id: state.externalId,
            variants: skus.map((sku) => ({ sku })),
          },
        },
      ],
    },
    token,
  );

  const operationId = resp.data.id;
  console.log(`  → opérationId : ${operationId} (démarrage automatique)`);
  const results = await pollOperation(operationId, token);
  console.log("✔ Résultat suppression produit :", JSON.stringify(results, null, 2));
}

async function cmdUpdate(): Promise<void> {
  const state = loadState();
  if (!state.externalId || !state.ankorstoreProductId) {
    console.log("Aucun produit de test enregistré. Lance d'abord `create`.");
    return;
  }

  const token = await getToken();
  const externalId = state.externalId;

  // 3 jeux d'images (1 produit principale + 3 par variante)
  const mainImage = "https://picsum.photos/seed/ankorstore-test-MAIN/800/800";
  const productImages = [
    { order: 1, url: mainImage },
    { order: 2, url: "https://picsum.photos/seed/ankorstore-test-product-2/800/800" },
    { order: 3, url: "https://picsum.photos/seed/ankorstore-test-product-3/800/800" },
  ];
  function variantImages(color: string) {
    return [
      { order: 1, url: `https://picsum.photos/seed/ankorstore-test-${color}-1/800/800` },
      { order: 2, url: `https://picsum.photos/seed/ankorstore-test-${color}-2/800/800` },
      { order: 3, url: `https://picsum.photos/seed/ankorstore-test-${color}-3/800/800` },
    ];
  }

  console.log("⌛ Création de l'opération d'update…");
  const operationId = await createOperation(token, "update");
  console.log(`  → opérationId : ${operationId}`);

  console.log("⌛ POST products (Rouge_M + Bleu_M + nouvelle Vert_L + images + prix + stock)…");
  const addResp = await api<{ meta?: { totalProductsCount?: number } }>(
    "POST",
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}/products`,
    {
      products: [
        {
          id: externalId,
          type: "catalog-integration-product",
          attributes: {
            external_id: externalId,
            name: "TEST À SUPPRIMER — produit factice de test API",
            description:
              "Ce produit existe uniquement pour tester l'intégration API. Il sera supprimé automatiquement. Ne pas commander.",
            currency: "EUR",
            vat_rate: 20,
            unit_multiplier: 1,
            wholesale_price: 15,
            retail_price: 30,
            made_in_country: "FR",
            main_image: mainImage,
            images: productImages,
            variants: [
              {
                sku: `${externalId}_ROUGE_M`,
                stock_quantity: 10,
                is_always_in_stock: false,
                wholesale_price: 15,
                retail_price: 30,
                original_wholesale_price: 15,
                options: [
                  { name: "color", value: "Rouge" },
                  { name: "size", value: "M" },
                ],
                images: variantImages("rouge"),
              },
              {
                sku: `${externalId}_BLEU_M`,
                stock_quantity: 10,
                is_always_in_stock: false,
                wholesale_price: 15,
                retail_price: 30,
                original_wholesale_price: 15,
                options: [
                  { name: "color", value: "Bleu" },
                  { name: "size", value: "M" },
                ],
                images: variantImages("bleu"),
              },
              {
                sku: `${externalId}_VERT_L`,
                stock_quantity: 10,
                is_always_in_stock: false,
                wholesale_price: 15,
                retail_price: 30,
                original_wholesale_price: 15,
                options: [
                  { name: "color", value: "Vert" },
                  { name: "size", value: "L" },
                ],
                images: variantImages("vert"),
              },
            ],
          },
        },
      ],
    },
    token,
  );
  console.log(`    totalProductsCount après POST : ${addResp.meta?.totalProductsCount ?? "?"}`);

  console.log("⌛ Lancement de l'opération (status: started)…");
  await api(
    "PATCH",
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}`,
    {
      data: {
        type: "catalog-integration-operation",
        id: operationId,
        attributes: { status: "started" },
      },
    },
    token,
  );

  console.log("⌛ Polling…");
  const results = await pollOperation(operationId, token);
  console.log("✔ Résultat update :", JSON.stringify(results, null, 2));
}

async function cmdCleanupRemnants(): Promise<void> {
  // Scanne toutes les variantes dont le SKU commence par "TEST-DELETE-" et
  // supprime les produits correspondants (déduplicat). Utilisé pour nettoyer
  // les essais de test ratés ou en doublon.
  const token = await getToken();

  console.log("⌛ Recherche des variantes TEST-DELETE-* via filter[skuOrName]…");
  const resp = await api<{
    data: {
      id: string;
      attributes: { sku?: string | null };
      relationships?: { product?: { data?: { id?: string } } };
    }[];
  }>(
    "GET",
    `/product-variants?filter[skuOrName]=TEST-DELETE-&page[limit]=100`,
    undefined,
    token,
  );

  const productIds = new Set<string>();
  const skuByProduct = new Map<string, string>();
  for (const v of resp.data ?? []) {
    const sku = v.attributes.sku ?? "";
    if (!sku.startsWith("TEST-DELETE-")) continue;
    const pid = v.relationships?.product?.data?.id;
    if (!pid) continue;
    productIds.add(pid);
    if (!skuByProduct.has(pid)) skuByProduct.set(pid, sku);
  }

  if (productIds.size === 0) {
    console.log("✔ Aucun produit TEST-DELETE-* trouvé. Tout est propre.");
    return;
  }

  console.log(`Trouvé ${productIds.size} produit(s) TEST-DELETE-* à supprimer :`);
  // L'externalId d'un produit = la racine du SKU (avant le "_")
  const externalIds: string[] = [];
  for (const [pid, sku] of skuByProduct) {
    const externalId = sku.split("_")[0];
    console.log(`  • productId=${pid}  externalId=${externalId}`);
    externalIds.push(externalId);
  }

  for (const externalId of externalIds) {
    console.log(`⌛ Suppression de ${externalId}…`);
    try {
      const delResp = await api<{ data: { id: string } }>(
        "POST",
        "/catalog/integrations/operations/delete",
        {
          source: "other",
          callbackUrl: "https://example.com/ankorstore-test-callback",
          products: [
            {
              type: "catalog-integration-product",
              attributes: { external_id: externalId },
            },
          ],
        },
        token,
      );
      const opId = delResp.data.id;
      const results = await pollOperation(opId, token);
      const ok = results[0]?.status === "success";
      console.log(`  ${ok ? "✔" : "❌"} ${externalId} : ${results[0]?.status ?? "?"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ ${externalId} : ${msg.slice(0, 200)}`);
    }
  }
}

function cmdClean(): void {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
    console.log("✔ Fichier d'état local supprimé.");
  } else {
    console.log("(Pas de fichier d'état local à supprimer.)");
  }
}

// ────────────────────────────────────────────────
// Entrypoint
// ────────────────────────────────────────────────

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "create":
      await cmdCreate();
      break;
    case "inspect":
      await cmdInspect();
      break;
    case "delete-variant":
      await cmdDeleteVariant(process.argv[3]);
      break;
    case "update":
      await cmdUpdate();
      break;
    case "cleanup":
      await cmdCleanupRemnants();
      break;
    case "delete-product":
      await cmdDeleteProduct();
      break;
    case "clean":
      cmdClean();
      break;
    default:
      console.log("Usage :");
      console.log("  npx tsx scripts/ankorstore-test.ts create");
      console.log("  npx tsx scripts/ankorstore-test.ts inspect");
      console.log("  npx tsx scripts/ankorstore-test.ts delete-variant [sku]");
      console.log("  npx tsx scripts/ankorstore-test.ts delete-product");
      console.log("  npx tsx scripts/ankorstore-test.ts clean");
      process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("❌ Erreur :", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
