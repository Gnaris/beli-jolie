/**
 * One-time migration: copy PFS references from PfsMapping table
 * to the new fields on Color, Category, and Composition models.
 *
 * Usage: npx tsx scripts/migrate-pfs-mappings.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Migrating PFS mappings to entity fields ===\n");

  // 1. Colors: PfsMapping type="color" → Color.pfsColorRef
  const colorMappings = await prisma.pfsMapping.findMany({ where: { type: "color" } });
  let colorUpdated = 0;
  for (const m of colorMappings) {
    try {
      const color = await prisma.color.findUnique({ where: { id: m.bjEntityId } });
      if (color && !color.pfsColorRef) {
        // pfsName is the normalized PFS name (lowercase) — we need the reference (uppercase)
        const pfsRef = m.pfsName.toUpperCase().replace(/\s+/g, "");
        await prisma.color.update({
          where: { id: m.bjEntityId },
          data: { pfsColorRef: pfsRef },
        });
        console.log(`  Color: "${color.name}" → pfsColorRef="${pfsRef}"`);
        colorUpdated++;
      }
    } catch {
      // Entity may have been deleted
    }
  }
  console.log(`  ${colorUpdated}/${colorMappings.length} colors updated\n`);

  // 2. Categories: PfsMapping type="category" → Category.pfsCategoryId
  const catMappings = await prisma.pfsMapping.findMany({ where: { type: "category" } });
  const catUpdated = 0;
  for (const m of catMappings) {
    try {
      const cat = await prisma.category.findUnique({ where: { id: m.bjEntityId } });
      if (cat && !cat.pfsCategoryId) {
        // For categories, pfsName might be the category reference, but we need the PFS ID
        // The PfsMapping doesn't store the PFS ID directly — we'll need the user to set this via the mapping UI
        console.log(`  Category: "${cat.name}" → PFS name "${m.pfsName}" (needs manual mapping via UI)`);
      }
    } catch {
      // Entity may have been deleted
    }
  }
  console.log(`  ${catUpdated}/${catMappings.length} categories updated (categories need manual mapping)\n`);

  // 3. Compositions: PfsMapping type="composition" → Composition.pfsCompositionRef
  const compMappings = await prisma.pfsMapping.findMany({ where: { type: "composition" } });
  let compUpdated = 0;
  for (const m of compMappings) {
    try {
      const comp = await prisma.composition.findUnique({ where: { id: m.bjEntityId } });
      if (comp && !comp.pfsCompositionRef) {
        const pfsRef = m.pfsName.toUpperCase().replace(/\s+/g, "");
        await prisma.composition.update({
          where: { id: m.bjEntityId },
          data: { pfsCompositionRef: pfsRef },
        });
        console.log(`  Composition: "${comp.name}" → pfsCompositionRef="${pfsRef}"`);
        compUpdated++;
      }
    } catch {
      // Entity may have been deleted
    }
  }
  console.log(`  ${compUpdated}/${compMappings.length} compositions updated\n`);

  // 4. ProductColor.pfsVariantId — from products with pfsProductId
  // We can't auto-fill this without querying PFS API — skip for now
  console.log("  ProductColor.pfsVariantId: requires PFS API query — will be filled on next sync\n");

  console.log("=== Migration complete ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
