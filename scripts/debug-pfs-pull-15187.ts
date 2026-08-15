/**
 * Simule pullAddLocalVariantFromPfs sur la variante "Noir" du produit 15187
 * (Issyma) en INLINANT tout le code avec logs très verbeux à chaque étape,
 * pour attraper l'endroit exact où ça plante.
 *
 * Ne modifie rien : la transaction fait `throw` à la fin pour tout annuler.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { Prisma } from "@prisma/client";
import { pfsGetVariants, pfsCheckReference, type PfsVariantItem } from "@/lib/pfs-api";
import { resolveVariant, downloadAllVariantImagesToBuffers } from "@/lib/pfs-import";
import { loadPfsImportPriceMarkup, applyImportMarkupToUnitPrice } from "@/lib/pfs-import-price-markup";
import { processProductImage } from "@/lib/image-processor";
import { productImageDir, productImageBaseName } from "@/lib/storage";
import { generateSku } from "@/lib/sku";

const TARGET_REF = "15187";
const TARGET_TENANT_SLUG = "issyma";
const PFS_VARIANT_IDS = [
  "pro_1a2c2454e9c53ada8fccada24960", // Noir (audit last week showed this)
  "pro_a79527d143bd5ebd5c9699095e6f", // Blanc
  "pro_e2fd2be5db2895e00a508d0bd85a", // Camel
];

async function tryOne(productId: string, pfsProductId: string, pfsVariantId: string, tenantSlug: string) {
  console.log(`\n\n═══════════════ ATTEMPT pfsVariantId=${pfsVariantId} ═══════════════`);
  try {
    console.log(`[1] pfsGetVariants(${pfsProductId})...`);
    const variantsResp = await pfsGetVariants(pfsProductId);
    console.log(`    → ${variantsResp.data?.length ?? 0} variantes`);

    console.log(`[2] pfsCheckReference("${TARGET_REF}")...`);
    const checkRef = await pfsCheckReference(TARGET_REF);
    console.log(`    → checkRef.exists=${checkRef?.exists} id=${checkRef?.product?.id}`);

    const pv = (variantsResp.data ?? []).find((v) => v.id === pfsVariantId);
    if (!pv) {
      console.log(`❌ [3] variant ${pfsVariantId} pas trouvée dans pfsGetVariants`);
      return;
    }
    console.log(`[3] variant trouvée : type=${pv.type} colorRef=${pv.item?.color.reference}`);

    console.log(`[4] resolveVariant...`);
    const warnings: string[] = [];
    const productImages = checkRef?.product?.images ?? {};
    const rv = await resolveVariant(pv as PfsVariantItem, warnings, productImages);
    if (!rv) {
      console.log(`❌ resolveVariant returned null`);
      return;
    }
    console.log(`    → rv.colorId=${rv.colorId} saleType=${rv.saleType} pfsVariantId=${rv.pfsVariantId} primaryPfsColorRef=${rv.primaryPfsColorRef}`);

    console.log(`[5] Vérif clash...`);
    const clash = await prisma.productColor.findFirst({
      where: { productId, colorId: rv.colorId, saleType: rv.saleType },
      select: { id: true },
    });
    if (clash) {
      console.log(`❌ CLASH — ProductColor déjà présente pour colorId=${rv.colorId}`);
      return;
    }
    console.log(`    → pas de clash`);

    console.log(`[6] loadPfsImportPriceMarkup...`);
    const importPriceMarkup = await loadPfsImportPriceMarkup();
    console.log(`    → ${JSON.stringify(importPriceMarkup)}`);

    const colorNames = new Map<string, string>();
    const colorName = pv.item?.color.labels?.fr ?? pv.item?.color.reference ?? "COLOR";
    for (const cid of rv.allColorIds.length > 0 ? rv.allColorIds : [rv.colorId]) {
      colorNames.set(cid, colorName);
    }
    console.log(`[7] Download images...`);
    const placeholder = `pull-${pfsVariantId}`;
    let downloaded: Awaited<ReturnType<typeof downloadAllVariantImagesToBuffers>> = [];
    try {
      downloaded = await downloadAllVariantImagesToBuffers(
        pfsProductId,
        TARGET_REF,
        colorNames,
        [{ id: placeholder, colorId: rv.colorId, pfsVariant: rv }],
      );
      console.log(`    → ${downloaded.length} images téléchargées`);
    } catch (err) {
      console.log(`    ⚠️  Download failed:`, err);
    }

    console.log(`[8] processProductImage boucle (tenant slug="${tenantSlug}")...`);
    const destDir = `public/${productImageDir(TARGET_REF, tenantSlug)}`;
    console.log(`    destDir=${destDir}`);
    const processedImages: { colorId: string; order: number; dbPath: string }[] = [];
    for (const di of downloaded) {
      try {
        const filename = productImageBaseName(TARGET_REF, colorName, di.img.order + 1);
        const { dbPath } = await processProductImage(di.body, destDir, filename);
        processedImages.push({ colorId: di.img.colorId, order: di.img.order, dbPath });
      } catch (err) {
        console.log(`    ⚠️  process failed for order=${di.img.order}:`, err);
      }
    }
    console.log(`    → ${processedImages.length} images process ok`);

    const skuColorIds = rv.allColorIds.length > 0 ? rv.allColorIds : [rv.colorId];
    const skuColorNames = skuColorIds.map((id) => colorNames.get(id) ?? "COLOR");
    const productMeta = await prisma.product.findFirst({
      where: { reference: TARGET_REF },
      select: { colors: { select: { id: true } } },
    });
    const nextIndex = (productMeta?.colors.length ?? 0) + 1;
    const sku = generateSku(TARGET_REF, skuColorNames, rv.saleType, nextIndex);
    console.log(`[9] sku=${sku}`);

    console.log(`[10] Transaction...`);
    try {
      await prisma.$transaction(async (tx) => {
        const pfsColorRefFromVariant = rv.primaryPfsColorRef?.trim() || null;
        console.log(`   tx: create ProductColor pfsColorRefOverride=${pfsColorRefFromVariant}`);
        const row = await tx.productColor.create({
          data: {
            productId,
            colorId: rv.colorId,
            unitPrice: applyImportMarkupToUnitPrice(rv.unitPrice, rv.packQuantity, importPriceMarkup),
            weight: rv.weight,
            stock: rv.stock,
            isPrimary: false,
            saleType: rv.saleType,
            packQuantity: rv.packQuantity,
            sku,
            pfsVariantId: rv.pfsVariantId,
            pfsColorRefOverride: pfsColorRefFromVariant,
          },
          select: { id: true },
        });
        console.log(`   tx: created PC#${row.id}`);
        throw new Error("ROLLBACK_DEBUG_ONLY");
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ROLLBACK_DEBUG_ONLY") {
        console.log(`✅ Transaction OK (rollback intentionnel)`);
      } else {
        console.log(`❌ Transaction FAIL:`, err);
      }
    }
  } catch (err) {
    console.log(`💥 EXCEPTION LEVÉE:`, err);
    if (err instanceof Error) {
      console.log(`   stack:\n${err.stack}`);
    }
  }
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TARGET_TENANT_SLUG } });
  if (!tenant) throw new Error("Tenant introuvable");
  console.log(`Tenant: ${tenant.slug} (${tenant.id})`);

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference: TARGET_REF },
      select: { id: true, pfsProductId: true },
    });
    if (!product?.pfsProductId) throw new Error("Produit sans pfsProductId");
    console.log(`Product: id=${product.id} pfsProductId=${product.pfsProductId}`);

    for (const vId of PFS_VARIANT_IDS) {
      await tryOne(product.id, product.pfsProductId, vId, tenant.slug);
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
