/**
 * Diagnostic — vérifie le listage des produits PFS (chronométré).
 * Utilisation : npx tsx scripts/test-pfs-list.ts
 */
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

async function getToken(): Promise<string> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["pfs_email", "pfs_password"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const email = map.get("pfs_email")!;
  const password = map.get("pfs_password")!;
  const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function main() {
  console.log("=== 1. Auth ===");
  const t0 = Date.now();
  const token = await getToken();
  console.log(`✅ token obtenu en ${Date.now() - t0}ms`);

  console.log("\n=== 2. Liste produits page 1 ===");
  const t1 = Date.now();
  const res = await fetch(`${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=20&status=ACTIVE`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  console.log(`HTTP ${res.status} en ${Date.now() - t1}ms`);
  if (!res.ok) {
    const txt = await res.text();
    console.error("❌ Erreur:", txt.substring(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  console.log("Total produits PFS :", data.meta?.total ?? "?");
  console.log("Pages totales :", data.meta?.last_page ?? "?");
  console.log("Items page 1 :", data.data?.length ?? 0);
  if (data.data?.[0]) {
    console.log("Exemple :", { ref: data.data[0].reference, name: data.data[0].name?.substring(0, 40) });
  }
  console.log(`\nEstimation scan complet (${data.meta?.last_page ?? "?"} pages × ~${Date.now() - t1}ms) = ${((data.meta?.last_page ?? 1) * (Date.now() - t1) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error("Erreur:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
