/**
 * Diag E292 : compare l'état local (BDD) et l'état PFS pour comprendre
 * pourquoi certaines variantes sont en rupture / désactivées côté PFS.
 *
 * Lecture seule — n'écrit rien.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { pfsGetVariants, pfsCheckReference } from "@/lib/pfs-api";

const TARGET_REF = "E292";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } });
  console.log("Tenants dispo :", tenants.map((t) => `${t.slug}(${t.id})`).join(", "));

  let found: { tenant: (typeof tenants)[number]; productId: string; pfsProductId: string | null } | null = null;

  for (const tenant of tenants) {
    await tenantALS.run(tenant.id, async () => {
      const p = await prisma.product.findFirst({
        where: { reference: TARGET_REF },
        select: { id: true, pfsProductId: true },
      });
      if (p && !found) {
        found = { tenant, productId: p.id, pfsProductId: p.pfsProductId };
        console.log(`  → trouvé dans ${tenant.slug} : ${p.id}`);
      }
    });
  }

  if (!found) {
    console.log(`❌ Produit ${TARGET_REF} introuvable dans aucun tenant`);
    return;
  }

  const { tenant, productId, pfsProductId } = found;
  console.log(`\n✅ Trouvé dans tenant ${tenant.slug} → productId=${productId} pfsProductId=${pfsProductId ?? "(non lié PFS)"}\n`);

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        pfsProductId: true,
        pfsEnabled: true,
        pfsSyncRequired: true,
        pfsBrandId: true,
        pfsBrandName: true,
        pfsLastSyncSnapshot: true,
        pfsCheckedAt: true,
        pfsCheckStatus: true,
        pfsCheckIssues: true,
        primaryColorId: true,
        colors: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            saleType: true,
            packQuantity: true,
            unitPrice: true,
            weight: true,
            stock: true,
            disabled: true,
            isPrimary: true,
            sku: true,
            pfsVariantId: true,
            pfsColorRefOverride: true,
            colorId: true,
            color: { select: { id: true, name: true, pfsColorRef: true } },
            variantSizes: {
              select: {
                quantity: true,
                size: { select: { name: true, pfsSizeRef: true } },
              },
            },
            packLines: {
              orderBy: { position: "asc" },
              select: {
                colorId: true,
                position: true,
                pfsColorRefOverride: true,
                color: { select: { name: true, pfsColorRef: true } },
                sizes: {
                  select: {
                    quantity: true,
                    size: { select: { name: true, pfsSizeRef: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!product) {
      console.log("❌ Produit introuvable après tenant scope");
      return;
    }

    console.log("═══════════════ LOCAL (BDD Beli & Jolie) ═══════════════");
    console.log(`Réf: ${product.reference}`);
    console.log(`Nom: ${product.name}`);
    console.log(`Statut: ${product.status}`);
    console.log(`pfsProductId: ${product.pfsProductId ?? "-"}`);
    console.log(`pfsBrand: ${product.pfsBrandName ?? "-"} (${product.pfsBrandId ?? "-"})`);
    console.log(`pfsEnabled: ${product.pfsEnabled}  pfsSyncRequired: ${product.pfsSyncRequired}`);
    console.log(`primaryColorId: ${product.primaryColorId ?? "-"}`);
    console.log(`pfsCheckedAt: ${product.pfsCheckedAt ?? "-"}  status: ${product.pfsCheckStatus ?? "-"}`);
    console.log(`\nVariantes locales (${product.colors.length}) :`);
    for (const v of product.colors) {
      const colorRef = v.pfsColorRefOverride?.trim() || v.color?.pfsColorRef || v.color?.name;
      console.log(
        `  • ${v.saleType} ${v.color?.name ?? "(sans couleur)"} → pfsVariantId=${v.pfsVariantId ?? "(non lié)"}`,
      );
      console.log(
        `    stock=${v.stock}  disabled=${v.disabled}  isPrimary=${v.isPrimary}  prix=${v.unitPrice}€  poids=${v.weight}kg  packQty=${v.packQuantity ?? "-"}`,
      );
      console.log(
        `    colorRefEffectif=${colorRef ?? "(vide)"}  (pfsColorRefOverride=${v.pfsColorRefOverride ?? "-"}  Color.pfsColorRef=${v.color?.pfsColorRef ?? "-"})`,
      );
      if (v.variantSizes.length) {
        console.log(
          `    tailles: ${v.variantSizes.map((s) => `${s.size.name}×${s.quantity}(${s.size.pfsSizeRef ?? "?"})`).join(", ")}`,
        );
      }
      if (v.packLines.length) {
        console.log(`    packLines:`);
        for (const pl of v.packLines) {
          const plColorRef = pl.pfsColorRefOverride?.trim() || pl.color?.pfsColorRef || pl.color?.name;
          console.log(
            `      · ${pl.color.name} (colorRefEffectif=${plColorRef ?? "-"}) tailles=${pl.sizes.map((s) => `${s.size.name}×${s.quantity}`).join(", ")}`,
          );
        }
      }
    }

    if (!product.pfsProductId) {
      console.log("\n⚠️ Produit pas lié PFS — impossible de récupérer côté PFS");
      return;
    }

    console.log("\n═══════════════ PFS (Paris Fashion Shop) ═══════════════");
    try {
      const [checkRef, variants] = await Promise.all([
        pfsCheckReference(product.reference),
        pfsGetVariants(product.pfsProductId),
      ]);

      console.log(`checkReference.exists=${checkRef?.exists ?? false}`);
      if (checkRef?.product) {
        const p = checkRef.product;
        console.log(`  id=${p.id}  ref=${p.reference}  brand=${p.brand?.name}`);
        console.log(`  status=${p.status}  default_color=${p.default_color}`);
        console.log(`  category=${p.category?.reference}  family=${p.family?.reference}`);
      }

      const list = variants.data ?? [];
      console.log(`\nVariantes PFS (${list.length}) :`);
      for (const v of list) {
        const colorRef = v.item?.color?.reference ?? v.packs?.[0]?.color?.reference ?? "(pack multi)";
        const colorLabelFr = v.item?.color?.labels?.fr ?? v.packs?.[0]?.color?.labels?.fr ?? "-";
        console.log(`  • ${v.type} ${colorLabelFr} (${colorRef}) → pfsVariantId=${v.id}`);
        console.log(
          `    stock_qty=${v.stock_qty}  in_stock=${v.in_stock}  is_active=${v.is_active}  is_star=${v.is_star}  pieces=${v.pieces}`,
        );
        console.log(
          `    prix unit=${v.price_sale?.unit?.value}€  total=${v.price_sale?.total?.value}€  weight=${v.weight}kg`,
        );
        if (v.type === "ITEM" && v.item) {
          console.log(`    taille=${v.item.size}`);
        }
        if (v.type === "PACK" && v.packs) {
          console.log(`    packs:`);
          for (const pack of v.packs) {
            console.log(
              `      · ${pack.color.labels?.fr ?? pack.color.reference} tailles=${pack.sizes.map((s) => `${s.size}×${s.qty}`).join(", ")}`,
            );
          }
        }
      }

      console.log("\n═══════════════ COMPARATIF ═══════════════");
      const localByPfsId = new Map(product.colors.filter((c) => c.pfsVariantId).map((c) => [c.pfsVariantId!, c]));
      const pfsById = new Map(list.map((v) => [v.id, v]));

      console.log("\n1) Variantes locales SANS correspondance PFS (mapping cassé) :");
      for (const v of product.colors) {
        if (!v.pfsVariantId) {
          console.log(`  ⚠️  ${v.color?.name} (${v.saleType}) — pas de pfsVariantId (non liée)`);
          continue;
        }
        if (!pfsById.has(v.pfsVariantId)) {
          console.log(`  ❌ ${v.color?.name} (${v.saleType}) pointe vers ${v.pfsVariantId} — INEXISTANT sur PFS`);
        }
      }

      console.log("\n2) Variantes PFS sans correspondance locale :");
      for (const v of list) {
        if (!localByPfsId.has(v.id)) {
          const label = v.item?.color?.labels?.fr ?? v.packs?.[0]?.color?.labels?.fr ?? "(?)";
          console.log(`  ⚠️  PFS ${v.type} ${label} (${v.id}) — pas mappée localement`);
        }
      }

      console.log("\n3) Écarts sur variantes appariées :");
      for (const [pfsId, local] of localByPfsId.entries()) {
        const remote = pfsById.get(pfsId);
        if (!remote) continue;
        const issues: string[] = [];
        if (Number(local.stock) !== remote.stock_qty) {
          issues.push(`stock local=${local.stock} vs PFS=${remote.stock_qty}`);
        }
        const expectedActive = !local.disabled;
        if (remote.is_active !== expectedActive) {
          issues.push(`is_active PFS=${remote.is_active} mais local.disabled=${local.disabled} (attendu ${expectedActive})`);
        }
        if (issues.length) {
          console.log(`  ❌ ${local.color?.name} (${local.saleType}, ${pfsId}) : ${issues.join(" | ")}`);
        } else {
          console.log(`  ✅ ${local.color?.name} (${local.saleType}) OK`);
        }
      }

      if (product.pfsLastSyncSnapshot) {
        console.log("\n═══════════════ pfsLastSyncSnapshot (dernier envoi) ═══════════════");
        console.log(JSON.stringify(product.pfsLastSyncSnapshot, null, 2));
      } else {
        console.log("\npfsLastSyncSnapshot: null (jamais synchronisé via l'update-in-place)");
      }
    } catch (err) {
      console.log("💥 Erreur PFS :", err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.log(err.stack);
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
