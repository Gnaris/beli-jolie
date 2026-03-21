/**
 * Test default_color endpoint
 * PATCH /catalog/products/{product_id} avec { default_color: "COLOR_REF" }
 */
import dotenv from "dotenv";
dotenv.config();

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";
const PRODUCT_ID = "pro_57fc702bb74fef655d0200a54b4d";

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

async function main() {
  console.log("=== TEST default_color ===\n");
  const token = await getToken();

  // Vérifier l'état initial via checkReference
  const checkRes = await api(token, "GET", `/catalog/products/checkReference/T999VS1`, "checkReference (état initial)");
  try {
    const prod = JSON.parse(checkRes.text).product;
    console.log(`  default_color: ${prod?.default_color}`);
  } catch {}

  // Test 1: PATCH avec { default_color: "SILVER" }
  await api(token, "PATCH", `/catalog/products/${PRODUCT_ID}`, "PATCH default_color=SILVER (sans data wrapper)", {
    default_color: "SILVER",
  });

  // Vérifier
  const check2 = await api(token, "GET", `/catalog/products/checkReference/T999VS1`, "checkReference après SILVER");
  try {
    const prod = JSON.parse(check2.text).product;
    console.log(`  default_color: ${prod?.default_color}`);
  } catch {}

  // Test 2: PATCH avec { data: { default_color: "GOLDEN" } } (au cas où wrapper data)
  await api(token, "PATCH", `/catalog/products/${PRODUCT_ID}`, "PATCH default_color=GOLDEN (avec data wrapper)", {
    data: { default_color: "GOLDEN" },
  });

  // Vérifier
  const check3 = await api(token, "GET", `/catalog/products/checkReference/T999VS1`, "checkReference après GOLDEN");
  try {
    const prod = JSON.parse(check3.text).product;
    console.log(`  default_color: ${prod?.default_color}`);
  } catch {}

  // Remettre à GOLDEN (valeur par défaut)
  await api(token, "PATCH", `/catalog/products/${PRODUCT_ID}`, "PATCH remettre default_color=GOLDEN", {
    default_color: "GOLDEN",
  });

  const checkFinal = await api(token, "GET", `/catalog/products/checkReference/T999VS1`, "checkReference final");
  try {
    const prod = JSON.parse(checkFinal.text).product;
    console.log(`  default_color: ${prod?.default_color}`);
  } catch {}

  console.log("\n=== TESTS TERMINÉS ===");
}

main().catch(console.error);
