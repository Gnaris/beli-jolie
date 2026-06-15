/**
 * Inspecte un produit côté Faire : récupère le JSON complet via l'API,
 * sauvegarde dans scripts/.faire-product-dump.json, et liste les champs.
 *
 * Usage :
 *   npx tsx scripts/check-faire-product.ts <faireProductId>   # ex. p_w7db3utw9u
 *   npx tsx scripts/check-faire-product.ts --ref F137         # lookup local BDD
 */
import { PrismaClient } from "@prisma/client";
import { faireFetch } from "@/lib/faire-api";
import { writeFile } from "node:fs/promises";

async function resolveFaireId(prisma: PrismaClient, arg: string): Promise<string | null> {
  if (arg.startsWith("p_")) return arg;
  // Sinon, considère que c'est une ref BJ (ex. "F137" ou "--ref F137")
  const ref = arg.replace(/^--ref[= ]?/, "").trim();
  const p = await prisma.product.findFirst({
    where: { reference: ref },
    select: { faireProductId: true },
  });
  return p?.faireProductId ?? null;
}

async function main() {
  const arg = process.argv[2] ?? "";
  if (!arg) {
    console.error("Usage: check-faire-product.ts <faireProductId|ref>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const faireId = await resolveFaireId(prisma, arg);
    if (!faireId) {
      console.error(`Aucun faireProductId trouvé pour "${arg}"`);
      process.exit(1);
    }
    console.log(`[check-faire] GET /products/${faireId}`);
    const res = await faireFetch(`/products/${faireId}`, { method: "GET" });
    const text = await res.text();
    console.log("Status:", res.status);
    if (!res.ok) {
      console.log("Body:", text.slice(0, 500));
      return;
    }
    const data = JSON.parse(text);

    await writeFile("scripts/.faire-product-dump.json", JSON.stringify(data, null, 2), "utf8");
    console.log("→ JSON complet écrit dans scripts/.faire-product-dump.json");

    // Vue d'ensemble
    console.log("\n=== Clés racine ===");
    console.log(Object.keys(data).sort().join("\n"));

    // Cherche tout champ qui pourrait porter les attributs de merchandising
    const merchKeys = Object.keys(data).filter((k) =>
      /attribute|metadata|detail|facet|filter|tag|material|occasion|style|theme|stone|package|production|set\b/i.test(
        k,
      ),
    );
    console.log("\n=== Champs potentiellement liés aux attributs « En savoir plus » ===");
    if (merchKeys.length === 0) {
      console.log("(aucun)");
    } else {
      for (const k of merchKeys) {
        console.log(`${k}: ${JSON.stringify(data[k], null, 2)}`);
      }
    }

    // Champs principaux déjà connus
    console.log("\n=== Champs principaux ===");
    console.log("lifecycle_state:", data.lifecycle_state);
    console.log("sale_state:", data.sale_state);
    console.log("name:", data.name);
    console.log("made_in_country:", data.made_in_country);
    console.log("taxonomy_type:", JSON.stringify(data.taxonomy_type));
    console.log("\n--- description ---\n" + (data.description ?? ""));
    console.log("\n--- short_description ---\n" + (data.short_description ?? ""));

    console.log("\n=== 1ère variante : clés ===");
    if (data.variants?.[0]) {
      console.log(Object.keys(data.variants[0]).sort().join("\n"));
      console.log("\nmeasurements:", JSON.stringify(data.variants[0].measurements ?? null, null, 2));
      console.log("tariff_code:", data.variants[0].tariff_code);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
