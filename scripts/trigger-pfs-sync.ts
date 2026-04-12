import { PrismaClient } from "@prisma/client";
import { decryptValue } from "../lib/encryption";

const prisma = new PrismaClient();
const PFS_BASE = "https://wholesaler-api.parisfashionshops.com/api/v1";

function applyMarkup(basePrice: number, type: string, value: number, rounding: string): number {
  if (value === 0) return basePrice;
  let price = type === "percent" ? basePrice * (1 + value / 100) : basePrice + value;
  switch (rounding) {
    case "down": price = Math.floor(price * 10) / 10; break;
    case "up": price = Math.ceil(price * 10) / 10; break;
    default: price = Math.round(price * 100) / 100; break;
  }
  return price;
}

async function main() {
  // Get credentials
  const credRows = await prisma.siteConfig.findMany({ where: { key: { in: ["pfs_email", "pfs_password"] } } });
  const credMap = new Map(credRows.map((r) => [r.key, decryptValue(r.value)]));
  const email = credMap.get("pfs_email")!;
  const password = credMap.get("pfs_password")!;

  // Get markup config
  const mkRows = await prisma.siteConfig.findMany({ where: { key: { startsWith: "pfs_price" } } });
  const mkMap = new Map(mkRows.map((r) => [r.key, r.value]));
  const mkType = mkMap.get("pfs_price_markup_type") || "percent";
  const mkValue = Number(mkMap.get("pfs_price_markup_value")) || 0;
  const mkRounding = mkMap.get("pfs_price_markup_rounding") || "none";
  console.log("Markup:", mkType, mkValue, mkRounding);

  // Auth
  const authRes = await fetch(`${PFS_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const token = (await authRes.json()).access_token;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };

  // Get product
  const prod = await prisma.product.findFirst({
    where: { reference: "AZFSF" },
    select: {
      pfsProductId: true,
      colors: {
        select: { id: true, saleType: true, unitPrice: true, pfsVariantId: true, packQuantity: true, variantSizes: { select: { quantity: true } } }
      }
    }
  });
  if (!prod?.pfsProductId) { console.log("No product"); return; }

  // For each variant with a pfsVariantId, compute the correct price and patch
  for (const v of prod.colors) {
    if (!v.pfsVariantId) { console.log("Skip variant", v.id, "- no pfsVariantId"); continue; }

    const dbPrice = Number(v.unitPrice);
    let unitPrice = dbPrice;
    if (v.saleType === "PACK") {
      const totalQty = v.variantSizes.reduce((s, vs) => s + vs.quantity, 0) || v.packQuantity || 1;
      unitPrice = Math.round((dbPrice / totalQty) * 100) / 100;
    }
    const expectedPrice = applyMarkup(unitPrice, mkType, mkValue, mkRounding);
    console.log(`Variant ${v.id} (${v.saleType}): DB=${dbPrice}€ → unit=${unitPrice}€ → PFS expected=${expectedPrice}€`);

    // Patch — PFS uses /catalog/products/variants (no product ID in URL)
    const patchRes = await fetch(`${PFS_BASE}/catalog/products/variants`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ data: [{
        variant_id: v.pfsVariantId,
        price_eur_ex_vat: expectedPrice,
      }] }),
    });
    const patchData = await patchRes.json();
    console.log("  PATCH result:", patchRes.status, JSON.stringify(patchData).substring(0, 200));
  }

  // Verify
  console.log("\n=== Verifying PFS prices ===");
  const verifyRes = await fetch(`${PFS_BASE}/catalog/products/${prod.pfsProductId}/variants`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const verifyData = await verifyRes.json();
  for (const v of verifyData.data || []) {
    console.log(`${v.type} | Price: ${v.price_sale?.unit?.value}€ | Color: ${v.item?.color?.reference || v.packs?.[0]?.color?.reference}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
