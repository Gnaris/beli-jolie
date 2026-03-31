import { prisma } from "../lib/prisma";
import { decryptIfSensitive } from "../lib/encryption";
import { processProductImage } from "../lib/image-processor";
import { extractReferenceFromSku, extractColorFromSku } from "../lib/ankorstore-api";

const AK_BASE_URL = "https://www.ankorstore.com/api/v1";

async function getToken(): Promise<string> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankorstore_client_id", "ankorstore_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const clientId = map.get("ankorstore_client_id") || process.env.ANKORSTORE_CLIENT_ID;
  const clientSecret = map.get("ankorstore_client_secret") || process.env.ANKORSTORE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Fallback to hardcoded for testing
    throw new Error("No credentials. Configure them in admin settings first.");
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
  const LIMIT = 5;
  console.log(`=== Ankorstore Sync Test (${LIMIT} products) ===\n`);

  // Get token
  console.log("1. Getting token...");
  const token = await getToken();
  console.log("   ✓ Token OK\n");

  // Fetch products
  console.log(`2. Fetching ${LIMIT} products...`);
  const res = await fetch(
    `${AK_BASE_URL}/products?include=productVariants&page%5Blimit%5D=${LIMIT}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
      },
    },
  );
  const json = await res.json();
  const products = json.data || [];
  const variants = (json.included || []).filter(
    (r: { type: string }) => r.type === "productVariants",
  );

  console.log(`   ✓ ${products.length} products, ${variants.length} variants\n`);

  // Process each product
  for (const p of products) {
    const attrs = p.attributes;
    const productVariants = (p.relationships?.productVariants?.data || [])
      .map((v: { id: string }) => variants.find((vr: { id: string }) => vr.id === v.id))
      .filter(Boolean);

    const firstSku = productVariants[0]?.attributes?.sku;
    if (!firstSku) {
      console.log(`   ✗ ${attrs.name} — no variants, skipping`);
      continue;
    }

    const reference = extractReferenceFromSku(firstSku);
    console.log(`\n--- ${reference} (${attrs.name}) ---`);
    console.log(`   Type: ${attrs.productTypeId}, Price: ${attrs.wholesalePrice}c, Variants: ${productVariants.length}`);

    // Check if exists
    const existing = await prisma.product.findUnique({ where: { reference } });
    if (existing) {
      console.log(`   → Already exists (id: ${existing.id}), updating akProductId`);
      await prisma.product.update({
        where: { id: existing.id },
        data: { akProductId: p.id, akSyncStatus: "synced", akSyncedAt: new Date() },
      });
      continue;
    }

    // Get or create category
    const typeKey = String(attrs.productTypeId);
    let mapping = await prisma.ankorstoreMapping.findUnique({
      where: { type_akValue: { type: "productType", akValue: typeKey } },
    });

    let categoryId: string;
    if (mapping && mapping.bjEntityId) {
      categoryId = mapping.bjEntityId;
    } else {
      const catName = `Ankorstore ${typeKey}`;
      const catSlug = `ankorstore-${typeKey}`;
      const cat = await prisma.category.upsert({
        where: { name: catName },
        create: { name: catName, slug: catSlug },
        update: {},
      });
      categoryId = cat.id;

      await prisma.ankorstoreMapping.upsert({
        where: { type_akValue: { type: "productType", akValue: typeKey } },
        create: { type: "productType", akValue: typeKey, akName: catName, bjEntityId: categoryId, bjName: catName },
        update: { bjEntityId: categoryId, bjName: catName },
      });
      console.log(`   📁 Created category: ${catName}`);
    }

    // Create product
    const product = await prisma.product.create({
      data: {
        reference,
        name: attrs.name,
        description: attrs.description || "",
        categoryId,
        status: attrs.active ? "ONLINE" : "OFFLINE",
        akProductId: p.id,
        akSyncStatus: "synced",
        akSyncedAt: new Date(),
      },
    });
    console.log(`   ✓ Product created: ${product.id}`);

    // Create variants
    for (let i = 0; i < productVariants.length; i++) {
      const v = productVariants[i];
      const vAttrs = v.attributes;
      const colorName = extractColorFromSku(vAttrs.sku);

      // Find or create color
      let colorId: string | null = null;
      if (colorName) {
        const existingColor = await prisma.color.findFirst({
          where: { name: colorName.trim() },
        });
        if (existingColor) {
          colorId = existingColor.id;
        } else {
          const newColor = await prisma.color.create({
            data: { name: colorName.trim(), hex: "#808080" },
          });
          colorId = newColor.id;
          console.log(`   🎨 Created color: ${colorName}`);
        }
      }

      const pc = await prisma.productColor.create({
        data: {
          productId: product.id,
          colorId,
          unitPrice: vAttrs.wholesalePrice / 100,
          weight: 0.1,
          stock: vAttrs.stockQuantity ?? 0,
          isPrimary: i === 0,
          saleType: "UNIT",
          akVariantId: v.id,
        },
      });
      console.log(`   ✓ Variant: ${vAttrs.sku} (${colorName || "no color"}) → ${pc.id}`);

      // Download first image
      const images = vAttrs.images || [];
      if (images.length > 0) {
        const imgUrl = images[0].url.split("?")[0];
        try {
          const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(20000) });
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            if (buffer.length > 1024) {
              const filename = `${reference}_${Date.now()}_0`;
              const { dbPath } = await processProductImage(buffer, "public/uploads/products", filename);
              await prisma.productColorImage.create({
                data: { productColorId: pc.id, productId: product.id, path: dbPath, position: 0 },
              });
              console.log(`   🖼️ Image uploaded: ${dbPath}`);
            }
          }
        } catch (e) {
          console.log(`   ✗ Image failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // Summary
  const totalSynced = await prisma.product.count({ where: { akProductId: { not: null } } });
  const totalCategories = await prisma.category.count();
  const totalColors = await prisma.color.count();
  console.log(`\n=== Done ===`);
  console.log(`Products synced: ${totalSynced}`);
  console.log(`Categories: ${totalCategories}`);
  console.log(`Colors: ${totalColors}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
