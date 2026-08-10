import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const OP = "1f1932f3-adae-6536-9c83-0e1ed87e9e18";
const UUID = "1f06faba-2a4f-6c7c-ad07-024ba929e6ad";

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!t) throw new Error("no tenant");
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId: t.id, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const m = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: m.get("ankors_client_id")!,
    client_secret: m.get("ankors_client_secret")!,
    scope: "*",
  });
  const tokR = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const tok = (await tokR.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.api+json" };

  for (let i = 0; i < 20; i++) {
    const r = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${OP}`, { headers: auth });
    const d = (await r.json()) as any;
    const a = d.data?.attributes ?? {};
    console.log(`[${(i * 3 + 3)}s] status=${a.status} total=${a.totalProductsCount} processed=${a.processedProductsCount}`);
    if (["succeeded", "failed", "partially_failed", "skipped"].includes(a.status)) {
      const resR = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${OP}/results`, { headers: auth });
      const resD = await resR.json();
      console.log("\nRésultats :", JSON.stringify(resD, null, 2).substring(0, 2000));
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Re-fetch le produit pour lister les variantes actuelles
  console.log("\n--- État final du produit chez Ankor ---");
  const pr = await fetch(`https://www.ankorstore.com/api/v1/products/${UUID}?include=productVariants`, { headers: auth });
  const pd = (await pr.json()) as any;
  const variants = (pd.included ?? []).filter((x: any) => x.type === "productVariants" && !x.attributes?.archivedAt);
  console.log(`Variantes actives : ${variants.length}`);
  for (const v of variants) {
    console.log(`  - id=${v.id}  sku="${v.attributes?.sku}"`);
  }
  const bleu = variants.find((v: any) => (v.attributes?.sku ?? "").toLowerCase().includes("bleu"));
  console.log(bleu ? `\n✅ Bleu Clair trouvée ! id=${bleu.id}` : "\n❌ Bleu Clair PAS trouvée");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
