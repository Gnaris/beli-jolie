import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const opId = "1f134584-0262-6914-91ce-629170b6d79b";

async function main() {
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } } });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const tokenRes = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: map.get("ankors_client_id")!, client_secret: map.get("ankors_client_secret")!, scope: "*" }),
  });
  const token = (await tokenRes.json()).access_token;
  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" };

  // Operation status
  const opRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}`, { headers: h });
  const op = (await opRes.json()).data?.attributes;
  console.log("Operation:", op?.status, "| processed:", op?.processedProductsCount, "| failed:", op?.failedProductsCount);

  // Results
  const resRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${opId}/results`, { headers: h });
  const results = await resRes.json();
  for (const r of results.data ?? []) {
    const a = r.attributes;
    console.log(`\n${a.externalProductId}: ${a.status} ${a.failureReason ?? ""}`);
    for (const i of a.issues ?? []) {
      console.log(`  ${i.field || "(global)"}: ${i.message}`);
    }
  }
  if (!results.data?.length) console.log("No results. Raw:", JSON.stringify(results).slice(0, 500));
}

main().catch(console.error).finally(() => prisma.$disconnect());
