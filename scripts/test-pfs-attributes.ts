/**
 * Test tous les endpoints /catalog/attributes/*
 */
import dotenv from "dotenv";
dotenv.config();

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

async function getToken(): Promise<string> {
  const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.PFS_EMAIL, password: process.env.PFS_PASSWORD }),
  });
  return (await res.json()).access_token;
}

async function fetchAttr(token: string, name: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${name.toUpperCase()}`);
  console.log(`${"═".repeat(60)}`);
  const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/${name}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  try {
    const json = JSON.parse(text);
    const data = json.data || json;
    if (Array.isArray(data)) {
      console.log(`Count: ${data.length}`);
      // Show first 5 items
      for (const item of data.slice(0, 5)) {
        console.log(JSON.stringify(item));
      }
      if (data.length > 5) console.log(`  ... et ${data.length - 5} de plus`);
    } else {
      console.log(JSON.stringify(data, null, 2).slice(0, 3000));
    }
  } catch {
    console.log(text.slice(0, 2000));
  }
}

async function main() {
  console.log("=== TEST PFS ATTRIBUTES (référentiels) ===\n");
  const token = await getToken();

  const attrs = [
    "collections",
    "categories",
    "colors",
    "compositions",
    "countries",
    "families",
    "genders",
    "sizes",
  ];

  for (const attr of attrs) {
    await fetchAttr(token, attr);
  }

  console.log("\n=== TERMINÉ ===");
}

main().catch(console.error);
