/**
 * Debug ref 15187 (Issyma) — l'audit PFS repropose sans cesse
 * d'ajouter Noir/Blanc/Camel meme apres avoir cliqué "Modifier".
 *
 * Ne modifie rien — lit local + PFS et affiche le matching côte à côte.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { pfsGetVariants } from "@/lib/pfs-api";

const TARGET_REF = "15187";
const TARGET_TENANT_SLUG = "issyma";

function normalizeColorRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TARGET_TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TARGET_TENANT_SLUG} introuvable`);
  console.log(`\n=== TENANT ${tenant.slug} (id=${tenant.id}) ===`);

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference: TARGET_REF },
      select: {
        id: true,
        reference: true,
        name: true,
        pfsProductId: true,
        status: true,
        tenantId: true,
        colors: {
          select: {
            id: true,
            tenantId: true,
            saleType: true,
            pfsVariantId: true,
            pfsColorRefOverride: true,
            colorId: true,
            createdAt: true,
            color: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                pfsColorRef: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!product) {
      console.log(`Produit ref ${TARGET_REF} introuvable sur ${TARGET_TENANT_SLUG}`);
      return;
    }

    console.log(`\nProduit: ${product.name}`);
    console.log(`  id=${product.id}  tenantId=${product.tenantId}  status=${product.status}`);
    console.log(`  pfsProductId=${product.pfsProductId ?? "(null)"}`);
    console.log(`  colors count = ${product.colors.length}`);

    console.log(`\n=== LOCAL ProductColors ===`);
    for (const pc of product.colors) {
      const effRef =
        pc.pfsColorRefOverride?.trim() ||
        pc.color?.pfsColorRef?.trim() ||
        pc.color?.name ||
        "(null)";
      console.log(
        `  PC#${pc.id.slice(0, 8)} tenantId=${pc.tenantId ?? "NULL"} saleType=${pc.saleType} ` +
          `pfsVariantId=${pc.pfsVariantId ?? "(null)"} ` +
          `override="${pc.pfsColorRefOverride ?? "(null)"}" ` +
          `color.name="${pc.color?.name}" ` +
          `color.pfsColorRef="${pc.color?.pfsColorRef ?? "(null)"}" ` +
          `color.tenantId=${pc.color?.tenantId ?? "NULL"} ` +
          `→ effRef="${effRef}" (norm="${normalizeColorRef(effRef)}") ` +
          `[createdAt=${pc.createdAt.toISOString()}]`,
      );
    }

    if (!product.pfsProductId) {
      console.log("\nPas de pfsProductId → impossible de lister les variantes PFS.");
      return;
    }

    console.log(`\n=== PFS getVariants(${product.pfsProductId}) ===`);
    const resp = await pfsGetVariants(product.pfsProductId);
    const pfsVariants = resp.data ?? [];
    console.log(`PFS variants count = ${pfsVariants.length}`);

    for (const pv of pfsVariants) {
      const c = pv.item?.color ?? pv.packs?.[0]?.color;
      const ref = c?.reference ?? "?";
      const labelFr = c?.labels?.fr ?? "?";
      const type = pv.type === "ITEM" ? "UNIT" : "PACK";
      console.log(
        `  PV#${pv.id} type=${type} ref="${ref}" (norm="${normalizeColorRef(ref)}") labelFr="${labelFr}"`,
      );
    }

    console.log(`\n=== MATCHING ===`);
    const pfsByKey = new Map<string, string>();
    for (const pv of pfsVariants) {
      const c = pv.item?.color ?? pv.packs?.[0]?.color;
      const ref = c?.reference ?? "?";
      const type = pv.type === "ITEM" ? "UNIT" : "PACK";
      pfsByKey.set(`${type}|${normalizeColorRef(ref)}`, pv.id);
    }
    for (const pc of product.colors) {
      const effRef =
        pc.pfsColorRefOverride?.trim() ||
        pc.color?.pfsColorRef?.trim() ||
        pc.color?.name ||
        "";
      const key = `${pc.saleType}|${normalizeColorRef(effRef)}`;
      const pvId = pfsByKey.get(key);
      console.log(`  LOCAL key="${key}"  →  PFS ${pvId ? "MATCH #" + pvId : "❌ AUCUN MATCH"}`);
    }
    for (const [key, pvId] of pfsByKey) {
      const matched = product.colors.some((pc) => {
        const effRef =
          pc.pfsColorRefOverride?.trim() ||
          pc.color?.pfsColorRef?.trim() ||
          pc.color?.name ||
          "";
        return `${pc.saleType}|${normalizeColorRef(effRef)}` === key;
      });
      if (!matched) {
        console.log(`  PFS key="${key}" #${pvId}  →  ❌ ORPHELIN (audit dira "à ajouter chez nous")`);
      }
    }

    console.log(`\n=== Recherche doublons Color "Noir"/"Blanc"/"Camel" cross-tenant ===`);
    const colorsGlobal = await (prisma as unknown as {
      $queryRawUnsafe: (q: string) => Promise<unknown[]>;
    }).$queryRawUnsafe(
      `SELECT id, tenantId, name, pfsColorRef FROM Color WHERE name IN ('Noir','Blanc','Camel') ORDER BY name, tenantId`,
    );
    console.log(JSON.stringify(colorsGlobal, null, 2));
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
