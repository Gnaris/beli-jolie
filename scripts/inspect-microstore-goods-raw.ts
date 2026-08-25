/**
 * Debug one-shot : dump la réponse brute /goods/get pour un produit BJ.
 * Sert à vérifier ce qui a été effectivement poussé côté Microstore.
 * Usage : npx tsx scripts/inspect-microstore-goods-raw.ts <REFERENCE>
 */

import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import { primeMicrostoreSessionKey, getMicrostoreSessionKey, MC_API_BASE } from "@/lib/microstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const prisma = new PrismaClient();

async function main() {
  const reference = process.argv[2];
  if (!reference) throw new Error("Usage: npx tsx scripts/inspect-microstore-goods-raw.ts <REFERENCE>");
  const TENANT_SLUG = process.env.TENANT_SLUG || "beli-jolie";

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference, tenantId: tenant.id },
      select: { id: true, reference: true, microstoreProductId: true, discountPercent: true, microstoreLastPushedAt: true },
    });
    if (!product) throw new Error(`Produit "${reference}" introuvable`);
    if (product.microstoreProductId == null) throw new Error(`Pas de microstoreProductId`);
    console.log("[BJ product]", product);

    const cfg = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "microstore_session_key" },
    });
    if (!cfg?.value) throw new Error("microstore_session_key absent");
    primeMicrostoreSessionKey(tenant.id, decryptIfSensitive("microstore_session_key", cfg.value));
    const key = await getMicrostoreSessionKey();
    if (!key) throw new Error("clé introuvable");

    const body = new URLSearchParams({
      key,
      id: String(product.microstoreProductId),
      cover_color: "0",
      app_version: "2.76.21", app_pid: "91", api_version: "1.0", lang: "en",
    });
    const res = await fetch(`${MC_API_BASE}/goods/get`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "app-pid": "91", "app-version": "2.76.21", "api-version": "1.0", lang: "en",
        "user-agent": "Dart/3.11 (dart:io)",
      },
      body: body.toString(),
    });
    const json = JSON.parse(await res.text()) as { info?: Record<string, unknown> };
    const info = json.info ?? {};
    // Résumé compact des champs importants
    console.log("\n===== RÉSUMÉ =====");
    console.log("price       :", info.price);
    console.log("sale (prod) :", info.sale);
    console.log("sale_1..4   :", info.sale_1, info.sale_2, info.sale_3, info.sale_4);
    const skus = (info.sku ?? []) as Array<Record<string, unknown>>;
    for (const s of skus) {
      console.log(`  SKU ${s.color_name} (id=${s.id}) → sale_1=${s.sale_1} sale_2=${s.sale_2} sale_3=${s.sale_3} sale_4=${s.sale_4} | price_1=${s.price_1}`);
    }
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
