/**
 * Test setAvailability par variant individuel
 * PATCH /catalog/products/variants/{variant_id}/setAvailability
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
  if (body) console.log(JSON.stringify(body, null, 2));
  const res = await fetch(`${PFS_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`Status: ${res.status} | ${text.slice(0, 2000)}`);
  return { status: res.status, text };
}

async function showVariantStatus(token: string) {
  const res = await api(token, "GET", `/catalog/products/${PRODUCT_ID}/variants`, "GET variants (is_active check)");
  try {
    const data = JSON.parse(res.text).data;
    for (const v of data) {
      const color = v.item?.color?.reference || v.packs?.map((p: any) => p.color?.reference).join('+') || "?";
      console.log(`  ${v.id} | ${v.type} ${color} | is_active=${v.is_active} in_stock=${v.in_stock}`);
    }
  } catch {}
}

async function main() {
  console.log("=== TEST setAvailability par variant ===\n");
  const token = await getToken();

  // État initial
  await showVariantStatus(token);

  // Test 1: PATCH avec { enable: false }
  await api(token, "PATCH", `/catalog/products/variants/${VARIANT_PACK_SILVER}/setAvailability`, "PATCH setAvailability enable=false", {
    enable: false,
  });

  await showVariantStatus(token);

  // Test 2: PATCH avec { data: { enable: false } } (au cas où wrapper data nécessaire)
  await api(token, "PATCH", `/catalog/products/variants/${VARIANT_PACK_SILVER}/setAvailability`, "PATCH setAvailability data.enable=false", {
    data: { enable: false },
  });

  await showVariantStatus(token);

  // Test 3: POST au lieu de PATCH
  await api(token, "POST", `/catalog/products/variants/${VARIANT_PACK_SILVER}/setAvailability`, "POST setAvailability enable=false", {
    enable: false,
  });

  await showVariantStatus(token);

  // Remettre actif
  await api(token, "PATCH", `/catalog/products/variants/${VARIANT_PACK_SILVER}/setAvailability`, "PATCH setAvailability enable=true", {
    enable: true,
  });

  await api(token, "POST", `/catalog/products/variants/${VARIANT_PACK_SILVER}/setAvailability`, "POST setAvailability enable=true", {
    enable: true,
  });

  // Vérification finale
  await showVariantStatus(token);

  console.log("\n=== TESTS TERMINÉS ===");
}

main().catch(console.error);
