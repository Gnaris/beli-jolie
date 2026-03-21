/**
 * Test PATCH variants avec variant_id (pas id!)
 */
import dotenv from "dotenv";
dotenv.config();

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";
const PRODUCT_ID = "pro_57fc702bb74fef655d0200a54b4d";
const VARIANT_PACK_SILVER = "pro_df299e9a65dcd8851b3f9cad6a00";

async function getToken(): Promise<string> {
  const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.PFS_EMAIL, password: process.env.PFS_PASSWORD }),
  });
  return (await res.json()).access_token;
}

async function api(token: string, method: string, path: string, label: string, body?: unknown) {
  console.log(`\n─── ${label} ───`);
  if (body) console.log(JSON.stringify(body, null, 2).slice(0, 1000));
  const res = await fetch(`${PFS_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`Status: ${res.status} | ${text.slice(0, 2000)}`);
  return { status: res.status, text };
}

async function showVariants(token: string) {
  const res = await api(token, "GET", `/catalog/products/${PRODUCT_ID}/variants`, "GET variants");
  try {
    const data = JSON.parse(res.text).data;
    for (const v of data) {
      const color = v.item?.color?.reference || v.packs?.map((p: any) => p.color?.reference).join('+') || "?";
      console.log(`  ${v.id} | ${v.type} ${color} | prix=${v.price_sale?.unit?.value} stock=${v.stock_qty} weight=${v.weight} discount=${JSON.stringify(v.discount)}`);
    }
  } catch {}
}

async function main() {
  console.log("=== TEST PATCH VARIANTS avec variant_id ===\n");
  const token = await getToken();

  // État initial
  await showVariants(token);

  // Test avec variant_id (exactement comme le frontend PFS)
  await api(token, "PATCH", "/catalog/products/variants", "PATCH avec variant_id + tous les champs", {
    data: [{
      variant_id: VARIANT_PACK_SILVER,
      weight: 10,
      stock_qty: 999,
      price_eur_ex_vat: 7.5,
      discount_type: "PERCENT",
      discount_value: 10,
    }],
  });

  // Vérifier
  await showVariants(token);

  // Remettre les valeurs d'origine
  await api(token, "PATCH", "/catalog/products/variants", "PATCH remettre valeurs normales", {
    data: [{
      variant_id: VARIANT_PACK_SILVER,
      weight: 0.03,
      stock_qty: 50,
      price_eur_ex_vat: 3.5,
      discount_type: null,
      discount_value: null,
    }],
  });

  // Vérifier retour
  await showVariants(token);

  // Tester aussi sur un ITEM
  // Trouver le ITEM GOLDEN
  const varRes = await api(token, "GET", `/catalog/products/${PRODUCT_ID}/variants`, "Find ITEM GOLDEN");
  const variants = JSON.parse(varRes.text).data;
  const itemGolden = variants.find((v: any) => v.type === "ITEM" && v.item?.color?.reference === "GOLDEN");

  if (itemGolden) {
    console.log(`\nITEM GOLDEN: ${itemGolden.id}`);

    await api(token, "PATCH", "/catalog/products/variants", "PATCH ITEM GOLDEN prix+stock", {
      data: [{
        variant_id: itemGolden.id,
        price_eur_ex_vat: 8.0,
        stock_qty: 200,
        weight: 0.1,
      }],
    });

    // Vérifier
    await showVariants(token);

    // Remettre
    await api(token, "PATCH", "/catalog/products/variants", "PATCH ITEM GOLDEN remettre", {
      data: [{
        variant_id: itemGolden.id,
        price_eur_ex_vat: 7.5,
        stock_qty: 500,
        weight: 0.12,
      }],
    });
  }

  // Vérification finale
  await showVariants(token);

  console.log("\n=== TESTS TERMINÉS ===");
}

main().catch(console.error);
