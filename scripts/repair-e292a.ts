/**
 * Script one-shot pour réparer E292A côté PFS + Ankor après le remaniement
 * des 10 couleurs (Multicolore, Noir, Blanc, Bleu, Rose → 10 bicolores
 * "- Argent" / "- Doré").
 *
 * Contexte :
 *   - 5 couleurs "- Argent" (avec override PFS) ont bien été créées côté PFS.
 *   - 5 couleurs "- Doré" (sans override) ont été refusées par PFS
 *     avec "Variant en doublon" — leur code couleur par défaut (BLACK / WHITE /
 *     BLUE / PINK / MULTICOLOR) était occupé par des carcasses soft-deletées
 *     (variantes vendues autrefois, non-suppressibles côté PFS).
 *   - Ankor : les 10 anciennes variantes AS sont encore liées, aucune
 *     nouvelle liée, external_id AS = null → garde-fou bloque tout push.
 *
 * Ce que fait ce script :
 *   1. Sonde l'état PFS (toutes variantes du produit) et Ankor
 *      (external_id + variantes actives).
 *   2. Construit un plan de réparation PFS :
 *        - Pour chaque "-Doré" BJ sans pfsVariantId, cherche une carcasse
 *          PFS avec le même code couleur → RECYCLE (PATCH prix/stock/poids
 *          + setAvailability(true) + upload photos + pose pfsVariantId BJ).
 *        - Si pas de carcasse → CREATE.
 *   3. Affiche le plan.
 *   4. Applique si --apply est passé.
 *
 * Ankor est sondé mais NON réparé par ce script — traitement séparé.
 *
 * Usage :
 *   npx tsx scripts/repair-e292a.ts            (dry-run, affiche le plan)
 *   npx tsx scripts/repair-e292a.ts --apply    (exécute)
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { pfsGetVariants } from "@/lib/pfs-api";
import {
  pfsCreateVariants,
  pfsDeleteImage,
  pfsPatchVariants,
  pfsSetVariantsAvailability,
  pfsUploadImage,
} from "@/lib/pfs-api-write";
import { ankorstoreGetProduct } from "@/lib/ankorstore-api";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

async function webpToJpegBuffer(absPath: string): Promise<Buffer> {
  const src = await readFile(absPath);
  return sharp(src).jpeg({ quality: 90 }).toBuffer();
}

const APPLY = process.argv.includes("--apply");
const PRODUCT_REF = "E292A";

type PfsVariant = {
  id: string;
  sku_suffix: string | null;
  is_active: boolean;
  stock_qty: number;
  weight: number;
  price_sale: { unit: { value: number } };
  colors?: { reference: string }[];
  item?: { color: { reference: string } };
};

function pfsColorCode(v: PfsVariant): string | null {
  return v.item?.color?.reference ?? v.colors?.[0]?.reference ?? null;
}

async function main() {
  console.log(`=== Repair ${PRODUCT_REF} — ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("tenant beliandjolie introuvable");

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference: PRODUCT_REF },
      include: {
        colors: {
          include: { color: true },
        },
      },
    });
    if (!product) throw new Error(`Produit ${PRODUCT_REF} introuvable`);
    if (!product.pfsProductId) throw new Error("Produit non lié à PFS");

    console.log(`Produit BJ : ${product.reference} (${product.name})`);
    console.log(`  pfsProductId    : ${product.pfsProductId}`);
    console.log(`  ankorsProductId : ${product.ankorsProductId}\n`);

    // ─── Phase PFS ────────────────────────────────────────────────────────
    console.log("--- PFS ---");
    const pfsResp = await pfsGetVariants(product.pfsProductId);
    const pfsVariants = (pfsResp.data ?? []) as PfsVariant[];
    console.log(`  ${pfsVariants.length} variantes PFS trouvées :`);
    for (const v of pfsVariants) {
      const code = pfsColorCode(v);
      console.log(
        `    • ${v.id}  color=${code ?? "?"}  active=${v.is_active}  stock=${v.stock_qty}  sku_suffix=${v.sku_suffix ?? "-"}`,
      );
    }

    // Carcasses = variantes désactivées OU stock=0 (donc soft-deleted /
    // recyclables), non déjà mappées à une BJ color actuelle.
    const linkedPfsIds = new Set(
      product.colors.map((c) => c.pfsVariantId).filter((x): x is string => !!x),
    );
    const carcasses = new Map<string, PfsVariant>(); // colorCode → variant
    for (const v of pfsVariants) {
      if (linkedPfsIds.has(v.id)) continue;
      const code = pfsColorCode(v);
      if (!code) continue;
      const isRecyclable = !v.is_active || v.stock_qty === 0;
      if (!isRecyclable) continue;
      // Si plusieurs candidates, on prend la première rencontrée.
      if (!carcasses.has(code)) carcasses.set(code, v);
    }

    console.log(`\n  ${carcasses.size} carcasses PFS disponibles au recyclage :`);
    for (const [code, v] of carcasses) {
      console.log(`    • code=${code}  → ${v.id}`);
    }

    // Couleurs BJ "-Doré" à réparer (celles qui étaient absentes ou dont on
    // vient de poser le pfsVariantId manuellement après la 1re passe).
    const missing = product.colors.filter((c) => c.color?.name?.includes("Doré"));
    console.log(`\n  ${missing.length} couleurs BJ "-Doré" à traiter sur PFS :`);
    type Action =
      | {
          type: "RECYCLE";
          bjColorName: string;
          bjProductColorId: string;
          targetPfsVariantId: string;
          colorCode: string;
          stock: number;
          price: number;
          weight: number;
          images: string[];
        }
      | {
          type: "CREATE";
          bjColorName: string;
          bjProductColorId: string;
          colorCode: string;
        };
    const plan: Action[] = [];
    for (const c of missing) {
      const code = c.pfsColorRefOverride?.trim() || c.color?.pfsColorRef || null;
      if (!code) {
        console.log(`    ⚠ ${c.color?.name} : pas de code couleur PFS résolu — skip`);
        continue;
      }
      const imgRows = await prisma.productColorImage.findMany({
        where: { productId: product.id, colorId: c.colorId ?? undefined },
        orderBy: { order: "asc" },
      });
      const imgs = imgRows.map((i) => i.path);
      // Priorité : si pfsVariantId déjà posé → on RECYCLE cet ID directement
      // (cas des CREATE de la passe précédente qui ont créé la variante mais
      //  échoué à l'upload).
      const targetId = c.pfsVariantId ?? carcasses.get(code)?.id ?? null;
      if (targetId) {
        plan.push({
          type: "RECYCLE",
          bjColorName: c.color?.name ?? "?",
          bjProductColorId: c.id,
          targetPfsVariantId: targetId,
          colorCode: code,
          stock: c.stock,
          price: Number(c.unitPrice),
          weight: c.weight,
          images: imgs,
        });
        const src = c.pfsVariantId ? "pfsVariantId déjà posé" : `carcasse ${code}`;
        console.log(
          `    ♻ RECYCLE ${c.color?.name} → PFS ${targetId} (via ${src}), ${imgs.length} photos`,
        );
      } else {
        plan.push({
          type: "CREATE",
          bjColorName: c.color?.name ?? "?",
          bjProductColorId: c.id,
          colorCode: code,
        });
        console.log(`    ✚ CREATE ${c.color?.name} (code ${code}) — pas de carcasse dispo`);
      }
    }

    // ─── Phase Ankor (sondage seulement) ─────────────────────────────────
    console.log("\n--- Ankor (sondage seulement, PAS de réparation ici) ---");
    if (product.ankorsProductId) {
      const asProd = await ankorstoreGetProduct(product.ankorsProductId);
      if (asProd) {
        console.log(`  external_id AS : ${JSON.stringify(asProd.externalId)}`);
        console.log(`  Variantes AS actives : ${asProd.variants.filter((v) => !v.archivedAt).length}`);
        for (const v of asProd.variants) {
          if (v.archivedAt) continue;
          console.log(`    • ${v.id}  sku=${v.sku}`);
        }
        const bjLinked = product.colors.filter((c) => c.ankorsVariantId).length;
        console.log(`  Variantes BJ liées à AS : ${bjLinked}/${product.colors.length}`);
      } else {
        console.log("  AS produit introuvable");
      }
    }

    // ─── Exécution PFS ─────────────────────────────────────────────────────
    if (!APPLY) {
      console.log("\n=== DRY-RUN — rien n'a été modifié ===");
      console.log("Relance avec --apply pour exécuter le plan PFS.");
      return;
    }

    console.log("\n=== APPLY — début de l'exécution PFS ===");
    let recycled = 0;
    let created = 0;
    let errors = 0;

    // Phase RECYCLE
    for (const a of plan) {
      if (a.type !== "RECYCLE") continue;
      try {
        console.log(`\n▶ RECYCLE ${a.bjColorName} → ${a.targetPfsVariantId}`);
        // 1. PATCH stock/prix/poids (champ attendu = variant_id, pas id)
        await pfsPatchVariants([
          {
            variant_id: a.targetPfsVariantId,
            price_eur_ex_vat: a.price,
            weight: a.weight,
            stock_qty: a.stock,
          },
        ]);
        console.log("  ✓ PATCH stock/prix/poids");
        // 2. setAvailability(true)
        await pfsSetVariantsAvailability([
          { pfsVariantId: a.targetPfsVariantId, enable: a.stock > 0 },
        ]);
        console.log(`  ✓ setAvailability(${a.stock > 0})`);
        // 3. Upload photos
        // Purger toutes les anciennes photos de ce color (slots 1..5)
        for (let s = 1; s <= 5; s++) {
          try { await pfsDeleteImage(product.pfsProductId!, s, a.colorCode); } catch { /* slot vide, OK */ }
        }
        for (let i = 0; i < a.images.length; i++) {
          const slot = i + 1; // 1-based
          const imgPath = a.images[i];
          const abs = path.join(process.cwd(), "public", imgPath.replace(/^\/+/, ""));
          const buf = await webpToJpegBuffer(abs);
          const filename = `image_${slot}.jpg`;
          await pfsUploadImage(product.pfsProductId!, buf, slot, a.colorCode, filename);
          console.log(`  ✓ upload slot=${slot} (${path.basename(imgPath)})`);
        }
        // 4. Pose pfsVariantId sur ProductColor BJ + reset snapshot
        await prisma.productColor.update({
          where: { id: a.bjProductColorId },
          data: { pfsVariantId: a.targetPfsVariantId },
        });
        console.log(`  ✓ pfsVariantId posé en BDD BJ`);
        recycled++;
      } catch (err) {
        console.error(`  ✗ ERREUR RECYCLE ${a.bjColorName} :`, err);
        errors++;
      }
    }

    // Phase CREATE
    const creates = plan.filter((a): a is Extract<Action, { type: "CREATE" }> => a.type === "CREATE");
    for (const a of creates) {
      try {
        console.log(`\n▶ CREATE ${a.bjColorName} (code ${a.colorCode})`);
        const pc = product.colors.find((c) => c.id === a.bjProductColorId)!;
        const imgRows = await prisma.productColorImage.findMany({
          where: { productId: product.id, colorId: pc.colorId ?? undefined },
          orderBy: { order: "asc" },
        });
        const stock = pc.stock;
        const isActive = stock > 0 && !pc.disabled;
        const { variantIds } = await pfsCreateVariants(product.pfsProductId!, [
          {
            type: "ITEM",
            color: a.colorCode,
            size: "TU",
            price_eur_ex_vat: Number(pc.unitPrice),
            weight: pc.weight,
            stock_qty: stock,
            is_active: isActive,
          },
        ]);
        const newId = variantIds[0];
        if (!newId) {
          console.error(`  ✗ PFS n'a pas renvoyé d'ID — probablement doublon caché`);
          errors++;
          continue;
        }
        console.log(`  ✓ create OK, pfsVariantId=${newId}`);
        for (let s = 1; s <= 5; s++) {
          try { await pfsDeleteImage(product.pfsProductId!, s, a.colorCode); } catch { /* slot vide, OK */ }
        }
        for (let i = 0; i < imgRows.length; i++) {
          const slot = i + 1;
          const img = imgRows[i];
          const abs = path.join(process.cwd(), "public", img.path.replace(/^\/+/, ""));
          const buf = await webpToJpegBuffer(abs);
          const filename = `image_${slot}.jpg`;
          await pfsUploadImage(product.pfsProductId!, buf, slot, a.colorCode, filename);
          console.log(`  ✓ upload slot=${slot} (${path.basename(img.path)})`);
        }
        await prisma.productColor.update({
          where: { id: a.bjProductColorId },
          data: { pfsVariantId: newId },
        });
        console.log(`  ✓ pfsVariantId posé en BDD BJ`);
        created++;
      } catch (err) {
        console.error(`  ✗ ERREUR CREATE ${a.bjColorName} :`, err);
        errors++;
      }
    }

    // Snapshot invalidé côté produit pour forcer une resync propre
    if (recycled > 0 || created > 0) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          pfsLastSyncSnapshot: { schemaVersion: 0 } as any,
          pfsSyncRequired: true,
        },
      });
      console.log(`\n  ✓ pfsLastSyncSnapshot reset + pfsSyncRequired=true`);
    }

    console.log(`\n=== BILAN PFS : ${recycled} recyclées, ${created} créées, ${errors} erreurs ===`);
    console.log(
      "\nAnkor NON traité. Après validation PFS, on codera un script séparé\n" +
        "pour Ankor (délie DB + suppression 10 anciennes AS + relance publish).\n",
    );
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
