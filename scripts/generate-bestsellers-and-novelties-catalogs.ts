/**
 * Génère 2 catalogues Beli & Jolie :
 *   1. « Bestsellers »  — top ventes des 12 derniers mois, agrégées sur PFS +
 *      eFashion + Ankorstore + Faire + Orderchamp + Microstore.
 *   2. « Nouveautés »   — produits les plus récents (createdAt ou lastRefreshedAt).
 *
 * Critères communs :
 *   - Tenant `beliandjolie` uniquement (Issyma exclu).
 *   - Produits `status = ONLINE` avec au moins une variante en stock (règle
 *     de visibilité publique — cf. lib/public-product-visibility.ts).
 *   - Sélection équilibrée entre catégories (round-robin) pour ne pas se
 *     retrouver avec 200 bagues.
 *   - Cible ~175 produits par catalogue (fenêtre 150-200 demandée par la cliente).
 *
 * Usage :
 *   npx tsx scripts/generate-bestsellers-and-novelties-catalogs.ts            # dry-run
 *   npx tsx scripts/generate-bestsellers-and-novelties-catalogs.ts --apply    # écrit en BDD
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

const TARGET_TOTAL = 175;
const APPLY = process.argv.includes("--apply");
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="))?.split("=")[1];
// Prod = "beliandjolie", local historique = "beli-jolie" — on tente les deux
// tant qu'on ne pointe pas explicitement un slug via --tenant=xxx.
const TENANT_SLUG_CANDIDATES = tenantArg
  ? [tenantArg]
  : ["beliandjolie", "beli-jolie"];

type ProductLite = {
  id: string;
  reference: string;
  name: string;
  categoryId: string;
  categoryName: string;
  createdAt: Date;
  lastRefreshedAt: Date | null;
};

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: { in: TENANT_SLUG_CANDIDATES } },
  });
  if (!tenant) {
    throw new Error(
      `Tenant introuvable (essayé : ${TENANT_SLUG_CANDIDATES.join(", ")})`,
    );
  }

  await tenantALS.run(tenant.id, async () => {
    console.log(`▶ Tenant : ${tenant.name} (${tenant.id})`);
    console.log(`▶ Mode : ${APPLY ? "APPLY (écriture BDD)" : "dry-run"}`);

    // ─────────────────────────────────────────────
    // 1) Produits éligibles (règle visibilité publique)
    // ─────────────────────────────────────────────
    const eligibleRaw = await prisma.product.findMany({
      where: {
        status: "ONLINE",
        colors: { some: { disabled: false, stock: { gt: 0 } } },
      },
      select: {
        id: true,
        reference: true,
        name: true,
        categoryId: true,
        createdAt: true,
        lastRefreshedAt: true,
        category: { select: { name: true } },
      },
    });

    const eligible: ProductLite[] = eligibleRaw.map((p) => ({
      id: p.id,
      reference: p.reference,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? "(sans catégorie)",
      createdAt: p.createdAt,
      lastRefreshedAt: p.lastRefreshedAt,
    }));
    const productById = new Map(eligible.map((p) => [p.id, p]));
    const eligibleIds = eligible.map((p) => p.id);

    console.log(`▶ ${eligible.length} produits éligibles (ONLINE + stock)`);

    if (eligible.length === 0) {
      console.log("⚠ Rien à générer — aucun produit ne remplit les critères.");
      return;
    }

    // ─────────────────────────────────────────────
    // 2) BESTSELLERS — agrégation ventes 12 mois marketplaces
    // ─────────────────────────────────────────────
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    console.log(`▶ Fenêtre bestsellers : depuis ${cutoff.toISOString().slice(0, 10)}`);

    const sold = new Map<string, number>();
    const addQty = (pid: string | null, qty: number) => {
      if (!pid || qty <= 0) return;
      sold.set(pid, (sold.get(pid) ?? 0) + qty);
    };

    const pfsItems = await prisma.pfsOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        pfsOrder: { createdAtPfs: { gte: cutoff }, status: { not: "CANCELLED" } },
      },
      select: { productId: true, qtyValidated: true },
    });
    pfsItems.forEach((it) => addQty(it.productId, it.qtyValidated));

    const efaItems = await prisma.efashionOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        efashionOrder: {
          createdAtEfashion: { gte: cutoff },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true, qtyTotal: true },
    });
    efaItems.forEach((it) => addQty(it.productId, it.qtyTotal));

    const ankItems = await prisma.ankorstoreOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        ankorstoreOrder: {
          createdAtAnkor: { gte: cutoff },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true, quantity: true },
    });
    ankItems.forEach((it) => addQty(it.productId, it.quantity));

    const faireItems = await prisma.faireOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        faireOrder: {
          createdAtFaire: { gte: cutoff },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true, quantity: true },
    });
    faireItems.forEach((it) => addQty(it.productId, it.quantity));

    const ocItems = await prisma.orderchampOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        orderchampOrder: {
          createdAtOrderchamp: { gte: cutoff },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true, quantity: true },
    });
    ocItems.forEach((it) => addQty(it.productId, it.quantity));

    const msItems = await prisma.microstoreOrderItem.findMany({
      where: {
        productId: { in: eligibleIds },
        microstoreOrder: {
          createdAtMicrostore: { gte: cutoff },
          status: { not: "CANCELLED" },
        },
      },
      select: { productId: true, quantity: true },
    });
    msItems.forEach((it) => addQty(it.productId, it.quantity));

    console.log(
      `  PFS ${pfsItems.length} · eFa ${efaItems.length} · Ankor ${ankItems.length} · ` +
        `Faire ${faireItems.length} · OC ${ocItems.length} · Microstore ${msItems.length} lignes`,
    );

    const rankedSales = [...sold.entries()]
      .map(([id, qty]) => ({ product: productById.get(id)!, qty }))
      .filter((r) => r.product)
      .sort((a, b) => b.qty - a.qty);

    console.log(`▶ ${rankedSales.length} produits éligibles ont ≥ 1 vente marketplace`);

    const bestsellersSelection = balanceByCategory(
      rankedSales.map((r) => r.product),
      TARGET_TOTAL,
    );

    // ─────────────────────────────────────────────
    // 3) NOUVEAUTÉS — les plus récents
    // ─────────────────────────────────────────────
    const rankedNovelties = [...eligible].sort((a, b) => {
      const ra = Math.max(a.createdAt.getTime(), a.lastRefreshedAt?.getTime() ?? 0);
      const rb = Math.max(b.createdAt.getTime(), b.lastRefreshedAt?.getTime() ?? 0);
      return rb - ra;
    });
    const noveltiesSelection = balanceByCategory(rankedNovelties, TARGET_TOTAL);

    // ─────────────────────────────────────────────
    // 4) Récap console
    // ─────────────────────────────────────────────
    console.log("\n═══ BESTSELLERS ═══");
    printSummary(bestsellersSelection, productById);
    console.log("\n═══ NOUVEAUTÉS ═══");
    printSummary(noveltiesSelection, productById);

    // ─────────────────────────────────────────────
    // 5) Écriture BDD (opt-in)
    // ─────────────────────────────────────────────
    if (!APPLY) {
      console.log("\n(pas de --apply : aucun catalogue créé — relancer avec --apply)");
      return;
    }

    await upsertCatalog(tenant.id, "Bestsellers", bestsellersSelection);
    await upsertCatalog(tenant.id, "Nouveautés", noveltiesSelection);
    console.log("\n✅ Catalogues créés.");
  });
}

/**
 * Round-robin par catégorie sur une liste déjà classée (par ventes ou récence).
 * Prend 1 produit de chaque catégorie à tour de rôle → équilibrage naturel,
 * les catégories qui « n'ont plus » sont sautées et on continue avec les autres.
 */
function balanceByCategory(ranked: ProductLite[], target: number): ProductLite[] {
  const byCat = new Map<string, ProductLite[]>();
  for (const p of ranked) {
    const list = byCat.get(p.categoryId) ?? [];
    list.push(p);
    byCat.set(p.categoryId, list);
  }

  const cursors = new Map<string, number>();
  for (const cat of byCat.keys()) cursors.set(cat, 0);

  const selected: ProductLite[] = [];
  const cats = [...byCat.keys()];
  while (selected.length < target) {
    let addedInRound = 0;
    for (const cat of cats) {
      const list = byCat.get(cat)!;
      const idx = cursors.get(cat)!;
      if (idx >= list.length) continue;
      selected.push(list[idx]);
      cursors.set(cat, idx + 1);
      addedInRound++;
      if (selected.length >= target) break;
    }
    if (addedInRound === 0) break; // plus rien dans aucune catégorie
  }
  return selected;
}

function printSummary(
  selected: ProductLite[],
  productById: Map<string, ProductLite>,
) {
  console.log(`  Sélection : ${selected.length} produits`);
  const byCat = new Map<string, number>();
  for (const p of selected) {
    byCat.set(p.categoryName, (byCat.get(p.categoryName) ?? 0) + 1);
  }
  for (const [cat, count] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    • ${cat.padEnd(30)} ${count}`);
  }
  // Top 5 en tête de liste
  console.log("  Aperçu 5 premiers :");
  selected.slice(0, 5).forEach((p, i) => {
    console.log(`    ${i + 1}. [${p.reference}] ${p.name} — ${p.categoryName}`);
  });
}

async function upsertCatalog(
  tenantId: string,
  title: string,
  selection: ProductLite[],
) {
  const existing = await prisma.catalog.findFirst({
    where: { tenantId, title },
    select: { id: true, token: true },
  });
  if (existing) {
    // Supprime tous les CatalogProduct puis on refait — token conservé, lien
    // partageable inchangé si la cliente en avait déjà diffusé un.
    await prisma.catalogProduct.deleteMany({ where: { catalogId: existing.id } });
    await prisma.catalog.update({
      where: { id: existing.id },
      data: { status: "ACTIVE" },
    });
    const data = selection.map((p, i) => ({
      catalogId: existing.id,
      productId: p.id,
      position: i,
      tenantId,
    }));
    if (data.length) await prisma.catalogProduct.createMany({ data });
    console.log(
      `↻ Catalogue « ${title} » rafraîchi (token conservé) — ` +
        `/catalogue/${existing.token} — ${selection.length} produits`,
    );
    return;
  }
  const catalog = await prisma.catalog.create({
    data: { title, status: "ACTIVE", tenantId },
  });
  const data = selection.map((p, i) => ({
    catalogId: catalog.id,
    productId: p.id,
    position: i,
    tenantId,
  }));
  if (data.length) await prisma.catalogProduct.createMany({ data });
  console.log(
    `✔ Catalogue « ${title} » créé — /catalogue/${catalog.token} — ` +
      `${selection.length} produits`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
