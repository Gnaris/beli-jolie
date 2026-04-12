import { PrismaClient } from "@prisma/client";
import { decryptValue } from "../lib/encryption";

const prisma = new PrismaClient();
const PFS_BASE = "https://wholesaler-api.parisfashionshops.com/api/v1";

async function main() {
  // Get credentials
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: ["pfs_email", "pfs_password"] } } });
  const map = new Map(rows.map((r) => [r.key, decryptValue(r.value)]));
  const email = map.get("pfs_email") || process.env.PFS_EMAIL;
  const password = map.get("pfs_password") || process.env.PFS_PASSWORD;

  if (!email || !password) { console.log("No PFS credentials"); return; }
  console.log("Auth with:", email);

  // Auth
  const authRes = await fetch(`${PFS_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const authData = await authRes.json();
  const token = authData.access_token;
  if (!token) { console.log("Auth failed:", JSON.stringify(authData)); return; }
  console.log("Auth OK");

  // Get product
  const prod = await prisma.product.findFirst({ where: { reference: "AZFSF" }, select: { pfsProductId: true } });
  console.log("pfsProductId:", prod?.pfsProductId);
  if (!prod?.pfsProductId) return;

  // Get variants from PFS
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const res = await fetch(`${PFS_BASE}/catalog/products/${prod.pfsProductId}/variants`, { headers });
  const data = await res.json();

  console.log("\n=== PFS Variants for AZFSF ===");
  console.log("Count:", data.data?.length ?? 0);
  for (const v of data.data || []) {
    console.log("---");
    console.log("Type:", v.type, "| Active:", v.is_active, "| Stock:", v.stock_qty);
    console.log("Price unit value:", v.price_sale?.unit?.value, "€");
    if (v.item) console.log("  Color:", v.item.color?.reference, "| Size:", v.item.size);
    if (v.packs?.length > 0) {
      for (const pk of v.packs) {
        console.log("  Pack color:", pk.color?.reference);
      }
    }
  }

  await prisma.$disconnect();
}
main();
