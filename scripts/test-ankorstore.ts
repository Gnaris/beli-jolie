import { prisma } from "../lib/prisma";
import { decryptIfSensitive } from "../lib/encryption";

const AK_BASE_URL = "https://www.ankorstore.com/api/v1";

async function getToken(): Promise<string> {
  // Read credentials directly from DB (bypassing unstable_cache)
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankorstore_client_id", "ankorstore_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const clientId = map.get("ankorstore_client_id") || process.env.ANKORSTORE_CLIENT_ID;
  const clientSecret = map.get("ankorstore_client_secret") || process.env.ANKORSTORE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credentials Ankorstore non trouvées en BDD. Configure-les dans Paramètres > Marketplaces.");
  }

  const res = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });

  if (!res.ok) throw new Error(`OAuth failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

async function main() {
  console.log("=== Test Ankorstore Integration ===\n");

  // 1. Get token
  console.log("1. Getting OAuth token...");
  const token = await getToken();
  console.log("   ✓ Token acquired\n");

  // 2. Fetch 10 products
  console.log("2. Fetching 10 products from Ankorstore...");
  const res = await fetch(
    `${AK_BASE_URL}/products?include=productVariants&page%5Blimit%5D=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
      },
    },
  );
  const json = await res.json();
  const products = json.data || [];
  const variants = (json.included || []).filter((r: { type: string }) => r.type === "productVariants");
  console.log(`   ✓ ${products.length} products, ${variants.length} variants\n`);

  // 3. Show product types
  const typeIds = new Set<number>();
  for (const p of products) {
    typeIds.add(p.attributes.productTypeId);
  }
  console.log("3. Product types found:", [...typeIds]);

  // 4. Create mappings in DB
  console.log("\n4. Creating mappings in AnkorstoreMapping...");
  for (const typeId of typeIds) {
    const count = products.filter((p: { attributes: { productTypeId: number } }) => p.attributes.productTypeId === typeId).length;
    await prisma.ankorstoreMapping.upsert({
      where: { type_akValue: { type: "productType", akValue: String(typeId) } },
      create: {
        type: "productType",
        akValue: String(typeId),
        akName: `Type ${typeId} (${count} produits)`,
        bjEntityId: "",
        bjName: "",
      },
      update: {
        akName: `Type ${typeId} (${count} produits)`,
      },
    });
    console.log(`   ✓ Type ${typeId} (${count} produits)`);
  }

  // 5. Show available categories
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  console.log("\n5. Available BJ categories:");
  for (const c of categories) {
    console.log(`   ${c.id}: ${c.name}`);
  }

  // 6. Auto-map all types to the first category for testing
  if (categories.length > 0) {
    const defaultCat = categories[0];
    console.log(`\n6. Auto-mapping all types to "${defaultCat.name}" for testing...`);
    for (const typeId of typeIds) {
      await prisma.ankorstoreMapping.update({
        where: { type_akValue: { type: "productType", akValue: String(typeId) } },
        data: { bjEntityId: defaultCat.id, bjName: defaultCat.name },
      });
    }
    console.log("   ✓ All types mapped\n");
  }

  // 7. Show final mappings
  const mappings = await prisma.ankorstoreMapping.findMany();
  console.log("7. Final mappings:");
  for (const m of mappings) {
    console.log(`   Type ${m.akValue} (${m.akName}) -> ${m.bjEntityId ? m.bjName : "(non associé)"}`);
  }

  // 8. Check current state
  const syncedCount = await prisma.product.count({ where: { akProductId: { not: null } } });
  console.log(`\n8. Currently synced products in BJ: ${syncedCount}`);

  console.log("\n=== Analysis complete. Mappings are ready. ===");
  console.log("You can now run the sync from /admin/ankorstore or test it with:");
  console.log("  npx tsx scripts/test-ankorstore-sync.ts");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
