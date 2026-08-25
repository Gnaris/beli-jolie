/**
 * Debug one-shot : force disable=1 sur un produit Microstore.
 *
 * Ne repush pas le produit complet (pour éviter unstable_cache hors HTTP).
 * Fait juste GET /goods/get pour lire l'état actuel puis /goods/update avec
 * les mêmes valeurs + `disable=1|0` selon le statut BJ.
 *
 * Usage :
 *   npx tsx scripts/dev/push-one-microstore.ts <REFERENCE>
 *   TENANT_SLUG=beli-jolie npx tsx scripts/dev/push-one-microstore.ts PRODUCTTESTANKORSTORE
 */

import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import { primeMicrostoreSessionKey } from "@/lib/microstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import {
  microstoreGetGoods,
  microstoreUpdateGoods,
  type MicrostoreSkuInput,
} from "@/lib/microstore-goods-crud";
import { shouldDisableOnMicrostore } from "@/lib/microstore-products";

const prisma = new PrismaClient();

async function main() {
  const reference = process.argv[2];
  if (!reference) {
    throw new Error("Usage : npx tsx scripts/dev/push-one-microstore.ts <REFERENCE>");
  }
  const TENANT_SLUG = process.env.TENANT_SLUG || "beli-jolie";

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference, tenantId: tenant.id },
      select: {
        id: true,
        reference: true,
        status: true,
        microstoreEnabled: true,
        microstoreProductId: true,
      },
    });
    if (!product) throw new Error(`Produit "${reference}" introuvable`);
    if (product.microstoreProductId == null) {
      throw new Error("microstoreProductId absent — le produit n'a jamais été poussé");
    }
    const disabled = shouldDisableOnMicrostore(product.status);
    console.log("[BJ]", product);
    console.log(
      `[BJ] visibilité attendue Microstore : disable=${disabled ? "1 (masqué)" : "0 (visible)"}`,
    );

    const cfg = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "microstore_session_key" },
    });
    if (!cfg?.value) throw new Error("microstore_session_key absent en BDD");
    primeMicrostoreSessionKey(
      tenant.id,
      decryptIfSensitive("microstore_session_key", cfg.value),
    );

    const current = await microstoreGetGoods(product.microstoreProductId);
    if (!current) throw new Error("Produit introuvable côté Microstore");
    console.log("[MS avant]", {
      disable: current.disable,
      bhb_updown: current.bhb_updown,
    });

    const preservedSkus: MicrostoreSkuInput[] = current.sku.map((s, idx) => ({
      id: Number(s.id),
      color_id: s.color_id,
      color_name: s.color_name,
      color_alias: s.color_alias || "",
      stock: Number(s.num_1) || 0,
      price: Number(s.price_1) || Number(s.price) || 0,
      orderBy: Number(s.order_by ?? idx + 1),
      goodsSn: s.goods_sn,
      bhbStatus: Number(s.bhb_status),
    }));

    await microstoreUpdateGoods({
      microstoreProductId: product.microstoreProductId,
      payload: {
        itemRef: current.item_ref,
        name: current.name,
        desc: current.desc || "",
        price: Number(current.price) || 0,
        weightGrams: Number(current.weight) || 0,
        productCountry: current.product_country || "CN",
        remarkMaterial: current.remark_material || "",
        remarkPackage: Number(current.remark_package) || 1,
        catId: current.cat_id,
        brandId: current.brand_id || "0",
        yearId: current.year_id || "0",
        seasonId: current.season_id || "0",
        numPerPack: Number(current.num_per_pack) || 1,
        disabled,
        skus: preservedSkus,
      },
    });

    const after = await microstoreGetGoods(product.microstoreProductId);
    console.log("[MS après]", {
      disable: after?.disable,
      bhb_updown: after?.bhb_updown,
    });
    // Microstore stocke `disable` comme timestamp Unix (secondes) de la
    // désactivation, pas un booléen `1/0`. Un `disable != "0"` = masqué,
    // `disable == "0"` = visible.
    const isNowHidden = after?.disable != null && after.disable !== "0";
    const ok = disabled === isNowHidden;
    console.log(
      ok
        ? `✅ Visibilité synchronisée (disable=${after?.disable})`
        : `❌ Microstore n'a pas mis à jour le flag disable (disable=${after?.disable})`,
    );
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
