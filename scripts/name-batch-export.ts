/**
 * Exporte le prochain lot de produits sans nouveau nom/description en JSON sur stdout.
 * Lit le journal data/name-review-log.json pour savoir ce qui est déjà traité.
 * Usage : npx tsx scripts/name-batch-export.ts <N>
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

const JOURNAL = path.join(process.cwd(), "data", "name-review-log.json");

(async () => {
  const N = parseInt(process.argv[2] ?? "10", 10);

  let journalRefs = new Set<string>();
  try {
    const raw = fs.readFileSync(JOURNAL, "utf-8");
    const j = JSON.parse(raw);
    journalRefs = new Set(Object.keys(j.products ?? {}));
  } catch {
    // pas de journal = tout est à traiter
  }

  const products = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      reference: { notIn: Array.from(journalRefs) },
    },
    take: N,
    orderBy: { createdAt: "desc" },
    include: {
      colorImages: { orderBy: { order: "asc" } },
      colors: {
        where: { isPrimary: true },
        take: 1,
        select: { colorId: true },
      },
      category: { select: { name: true } },
    },
  });

  const out = products.map((p) => {
    const primaryColorId = p.colors[0]?.colorId ?? null;
    const imgForPrimary = p.colorImages.find((i) => i.colorId === primaryColorId);
    const imgFallback = p.colorImages[0];
    return {
      id: p.id,
      reference: p.reference,
      name: p.name,
      description: p.description,
      category: p.category?.name ?? null,
      imagePath: (imgForPrimary || imgFallback)?.path ?? null,
    };
  });

  console.log(JSON.stringify({
    journalSize: journalRefs.size,
    requested: N,
    returned: out.length,
    products: out,
  }, null, 2));

  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
