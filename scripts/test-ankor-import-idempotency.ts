/**
 * Test décisif : est-ce qu'un import avec external_id existant MATCHE le
 * produit existant (bonne nouvelle) ou CRÉE UN DOUBLON (mauvaise) ?
 *
 * Étapes :
 *  1. Publish produit factice "TEST-DELETE-DEBUG-N" avec 1 variante
 *  2. Attend qu'il apparaisse chez Ankor + note son UUID
 *  3. Envoie un 2ᵉ import même external_id avec 2 variantes
 *  4. Compte combien de produits ont cet external_id chez Ankor
 *     - 1 seul (et 2 variantes) → Ankor match par external_id ✅
 *     - 2 produits → doublon ❌
 *  5. Cleanup : delete les 1-2 produits factices
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const EXT_ID = `TEST-DELETE-DEBUG-${Date.now()}`;

async function auth() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("no tenant");
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId: tenant.id, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const m = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: m.get("ankors_client_id")!,
    client_secret: m.get("ankors_client_secret")!,
    scope: "*",
  });
  const tk = (await (await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  })).json()) as { access_token: string };
  return { Authorization: "Bearer " + tk.access_token, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" };
}

async function pollOp(H: any, opId: string, label: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = (await (await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}`, { headers: H })).json()) as any;
    const s = st.data.attributes.status;
    console.log(`  [${label}][${i * 3 + 3}s] status=${s} processed=${st.data.attributes.processedProductsCount}`);
    if (["succeeded", "failed", "partially_failed", "skipped"].includes(s)) {
      const rs = await (await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}/results`, { headers: H })).json();
      console.log(`  RESULTS:`, JSON.stringify(rs).substring(0, 800));
      return s;
    }
  }
  return "timeout";
}

async function importOp(H: any, opType: "import" | "update", variants: any[]) {
  const opRes = await fetch("https://www.ankorstore.com/api/v1/catalog/integrations/operations", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      data: { type: "catalog-integration-operation", attributes: { operationType: opType, source: "other", callbackUrl: "https://example.com/no-cb" } },
    }),
  });
  const opId = (await opRes.json() as any).data.id;

  const productPayload = {
    id: EXT_ID,
    type: "catalog-integration-product",
    attributes: {
      external_id: EXT_ID,
      name: "TEST DELETE debug idempotency",
      description: "Test produit factice à supprimer après. This is a test product for debugging import idempotency. Please ignore.",
      main_image: "https://img.ankorstore.com/products/images/6256751-47fad4c169d342.jpg",
      currency: "EUR",
      vat_rate: 20,
      unit_multiplier: 1,
      wholesale_price: 500,
      retail_price: 1500,
      made_in_country: "CN",
      variants,
    },
  };
  await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}/products`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ products: [productPayload] }),
  });
  await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } } }),
  });
  return opId;
}

async function findByName(H: any, name: string) {
  // Recherche par nom pour trouver le/les produits factices
  const url = `https://www.ankorstore.com/api/v1/products?filter[skuOrName]=${encodeURIComponent(name)}&page[limit]=20`;
  const rs = await (await fetch(url, { headers: H })).json() as any;
  return (rs.data ?? []).map((d: any) => ({ id: d.id, name: d.attributes?.name, updated: d.attributes?.updatedAt }));
}

async function main() {
  const H = await auth();
  console.log(`Ext_id de test: ${EXT_ID}\n`);

  // Step 1 : Publish avec 1 variante
  console.log("=== STEP 1: import #1 — 1 variante ===");
  const op1 = await importOp(H, "import", [
    {
      sku: `${EXT_ID}_ROUGE`,
      ian: null,
      stock_quantity: 10,
      is_always_in_stock: false,
      wholesale_price: 500,
      retail_price: 1500,
      original_wholesale_price: 500,
      options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }],
    },
  ]);
  const s1 = await pollOp(H, op1, "import1");
  console.log(`Op1 final: ${s1}\n`);

  // Attend un peu que l'indexation Ankor soit à jour
  await new Promise((r) => setTimeout(r, 5000));

  // Cherche le produit
  const before = await findByName(H, EXT_ID);
  console.log(`AVANT import #2 — produits trouvés avec ext_id=${EXT_ID}:`, before);

  // Step 2 : Second import avec 2 variantes (ancienne + nouvelle)
  console.log("\n=== STEP 2: import #2 — même external_id + 2 variantes (Rouge existant + Vert new) ===");
  const op2 = await importOp(H, "import", [
    {
      sku: `${EXT_ID}_ROUGE`,
      ian: null,
      stock_quantity: 10,
      is_always_in_stock: false,
      wholesale_price: 500,
      retail_price: 1500,
      original_wholesale_price: 500,
      options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }],
    },
    {
      sku: `${EXT_ID}_VERT`,
      ian: null,
      stock_quantity: 20,
      is_always_in_stock: false,
      wholesale_price: 500,
      retail_price: 1500,
      original_wholesale_price: 500,
      options: [{ name: "color", value: "Vert" }, { name: "size", value: "TU" }],
    },
  ]);
  const s2 = await pollOp(H, op2, "import2");
  console.log(`Op2 final: ${s2}\n`);

  await new Promise((r) => setTimeout(r, 5000));

  // Step 3 : Cherche à nouveau
  const after = await findByName(H, EXT_ID);
  console.log(`APRÈS import #2 — produits trouvés avec ext_id=${EXT_ID}:`, after);

  console.log("\n========= VERDICT =========");
  if (after.length === 1) {
    console.log("✅ Ankor a MATCHÉ par external_id (1 seul produit). Notre garde-fou est TROP STRICT.");
    console.log("   → Le champ external_id est bien stocké chez Ankor, juste pas exposé via GET.");
    console.log("   → On peut retirer le garde-fou et l'ajout de couleurs marchera à nouveau.");
  } else if (after.length >= 2) {
    console.log(`❌ Ankor a CRÉÉ ${after.length} produits (doublon). Notre garde-fou est LÉGITIME.`);
    console.log("   → Le champ external_id n'est pas vraiment stocké chez Ankor.");
    console.log("   → Il faudra passer par le support Ankor pour un batch fix.");
  } else {
    console.log("⚠️  Aucun produit trouvé (indexation en retard ? cherche à nouveau dans 30s)");
  }

  // Step 4 : Cleanup — supprime tous les produits factices
  console.log("\n=== STEP 4: Cleanup ===");
  const toDelete = await findByName(H, EXT_ID);
  for (const p of toDelete) {
    // Récupère les SKU des variantes
    const detail = await (await fetch(`https://www.ankorstore.com/api/v1/products/${p.id}?include=productVariants`, { headers: H })).json() as any;
    const skus = (detail.included ?? []).filter((x: any) => x.type === "productVariants").map((v: any) => v.attributes.sku);
    console.log(`  Deleting ${p.id} (${skus.length} skus)`);
    if (skus.length === 0) continue;
    const delRes = await fetch("https://www.ankorstore.com/api/v1/catalog/integrations/operations/delete", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        source: "other",
        callbackUrl: "https://example.com/no-cb",
        products: [{ type: "catalog-integration-product", attributes: { external_id: EXT_ID, variants: skus.map((sku: string) => ({ sku })) } }],
      }),
    });
    console.log(`    Delete kick-off status: ${delRes.status}`);
  }
  console.log("Cleanup lancé. Vérifier le dashboard Ankor dans quelques minutes.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
