/**
 * Script de test eFashion — upload de 2 photos par couleur sur le produit
 * de test créé par `scripts/efashion-test-create.ts`.
 *
 * Usage :
 *   npx tsx scripts/efashion-test-upload-photos.ts
 *
 * Convertit chaque image source (.webp) en JPEG via sharp avant l'envoi,
 * eFashion attendant du JPEG (cf. lib/efashion-photos.ts).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";

// ─── IDs du produit créé au step précédent ───────────────────────────────
const TARGETS = [
  {
    label: "Turquoise (couleur 1)",
    efashionProductId: 3665828,
    sources: [
      "public/uploads/produits/a459e/a459e-argent-1.webp",
      "public/uploads/produits/f137/f137-argent-1.webp",
    ],
  },
  {
    label: "Moutarde (couleur 2)",
    efashionProductId: 3665829,
    sources: [
      "public/uploads/produits/a459e/a459e-doré-1.webp",
      "public/uploads/produits/f137/f137-doré-1.webp",
    ],
  },
];

async function uploadOne(
  efashionProductId: number,
  files: Array<{ buffer: Buffer; filename: string }>,
) {
  await ensureEfashionSession();
  const form = new FormData();
  for (const f of files) {
    const blob = new Blob([new Uint8Array(f.buffer)], { type: "image/jpeg" });
    form.append("photos", blob, f.filename);
  }
  form.append("productId", String(efashionProductId));

  const res = await efashionFetch("/api/upload-product-photo", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<{
    success: boolean;
    message?: string;
    photos: string[];
    nbPhotos: number;
  }>;
}

async function main() {
  console.log("→ Connexion eFashion...");
  await ensureEfashionSession();
  console.log("  ✓ Session OK\n");

  for (const target of TARGETS) {
    console.log(`→ Préparation des photos pour ${target.label} (productId ${target.efashionProductId})`);
    const files: Array<{ buffer: Buffer; filename: string }> = [];

    for (let i = 0; i < target.sources.length; i++) {
      const rel = target.sources[i];
      const full = path.resolve(process.cwd(), rel);
      console.log(`   • Lecture ${rel}`);
      const webpBuffer = await readFile(full);
      console.log(`     conversion .webp → .jpg (sharp, quality 90)...`);
      const jpegBuffer = await sharp(webpBuffer).jpeg({ quality: 90 }).toBuffer();
      const filename = `test-ef-${target.efashionProductId}-${i + 1}.jpg`;
      files.push({ buffer: jpegBuffer, filename });
      console.log(`     ✓ ${(jpegBuffer.length / 1024).toFixed(0)} Ko prêts (${filename})`);
    }

    console.log(`   → Upload de ${files.length} photos vers eFashion...`);
    const result = await uploadOne(target.efashionProductId, files);
    console.log(`   ✓ Réponse eFashion :`);
    console.log(`     success    = ${result.success}`);
    console.log(`     nbPhotos   = ${result.nbPhotos}`);
    console.log(`     photos     = ${JSON.stringify(result.photos)}`);
    if (result.message) console.log(`     message    = ${result.message}`);
    console.log("");
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log("✅ Photos envoyées sur les 2 couleurs du produit test");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ ÉCHEC :", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
