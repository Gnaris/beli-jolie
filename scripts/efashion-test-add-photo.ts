/**
 * Script — ajoute 1 photo supplémentaire à chaque couleur du produit test.
 *
 * Usage : npx tsx scripts/efashion-test-add-photo.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import { efashionGetProductPhotos } from "@/lib/efashion-photos";

const TARGETS = [
  {
    label: "Turquoise",
    efashionProductId: 3665828,
    source: "public/uploads/produits/a219/a219-argent-1.webp",
  },
  {
    label: "Moutarde",
    efashionProductId: 3665829,
    source: "public/uploads/produits/a219/a219-doré-1.webp",
  },
];

async function uploadOne(efashionProductId: number, buffer: Buffer, filename: string) {
  await ensureEfashionSession();
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: "image/jpeg" });
  form.append("photos", blob, filename);
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
  await ensureEfashionSession();
  console.log("→ Session eFashion OK\n");

  for (const target of TARGETS) {
    console.log(`→ ${target.label} (productId ${target.efashionProductId})`);

    const before = await efashionGetProductPhotos(target.efashionProductId);
    console.log(`   Avant : ${before.nbPhotos} photo(s)`);

    const full = path.resolve(process.cwd(), target.source);
    console.log(`   Lecture ${target.source}`);
    const webp = await readFile(full);
    const jpeg = await sharp(webp).jpeg({ quality: 90 }).toBuffer();
    const filename = `test-ef-${target.efashionProductId}-3.jpg`;
    console.log(`   Conversion → JPEG (${(jpeg.length / 1024).toFixed(0)} Ko, ${filename})`);

    const result = await uploadOne(target.efashionProductId, jpeg, filename);
    console.log(`   Upload réponse : success=${result.success}  nbPhotos=${result.nbPhotos}`);
    result.photos.forEach((p) => console.log(`     ${p}`));

    const after = await efashionGetProductPhotos(target.efashionProductId);
    console.log(`   Après : ${after.nbPhotos} photo(s) au total\n`);
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log("✅ 3ᵉ image ajoutée sur chaque couleur");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
