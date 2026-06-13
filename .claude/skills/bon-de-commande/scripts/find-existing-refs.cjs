#!/usr/bin/env node
/**
 * Lit un parsed.json (sortie de parse-po.cjs) et sort sur stdout un JSON
 * tableau des références qui existent déjà en BDD du site Beli & Jolie.
 *
 * Usage :
 *   node find-existing-refs.cjs <parsed.json>
 *
 * Le tableau peut être passé à translate-and-build.cjs en 3e argument pour
 * exclure ces produits du fichier d'import généré.
 */
const fs = require("fs");
const { PrismaClient } = require(require("path").join(
  process.cwd(),
  "node_modules",
  "@prisma/client"
));

const PARSED = process.argv[2];
if (!PARSED) {
  console.error("Usage : node find-existing-refs.cjs <parsed.json>");
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(PARSED, "utf-8"));
const refs = parsed.products.map((p) => p.reference);

(async () => {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.product.findMany({
      where: { reference: { in: refs } },
      select: { reference: true },
    });
    process.stdout.write(JSON.stringify(existing.map((e) => e.reference)));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
