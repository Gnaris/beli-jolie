/**
 * Test bout-en-bout : crée un produit BJ PRODUCTTESTANKORSTORE et le publie sur Ankor.
 *
 * Simule ce qui se passe quand la cliente clique "Publier sur Ankorstore" depuis
 * l'UI, mais bypass le worker et l'auth HTTP. Utile pour valider que la chaîne
 * BJ → Ankor fonctionne bout-en-bout.
 *
 * Usage : npx tsx scripts/ankorstore-test-e2e-publish.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

const REFERENCE = "PRODUCTTESTANKORSTORE";

/** PNG 100×100 unicolore, ~200 octets. */
function makeTestPng(rgb: [number, number, number]): Buffer {
  const w = 100, h = 100;
  const [r, g, b] = rgb;
  const scanline = new Uint8Array(w * 3 + 1);
  for (let i = 0; i < w; i++) { scanline[1 + i * 3] = r; scanline[2 + i * 3] = g; scanline[3 + i * 3] = b; }
  const raw = new Uint8Array(h * scanline.length);
  for (let y = 0; y < h; y++) raw.set(scanline, y * scanline.length);
  const compressed = zlib.deflateSync(raw);
  const crc32 = (buf: Uint8Array): number => { let c = ~0 >>> 0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type: string, data: Uint8Array): Uint8Array => { const typeBuf = new TextEncoder().encode(type); const lenBuf = new Uint8Array(4); new DataView(lenBuf.buffer).setUint32(0, data.length); const crcInput = new Uint8Array(typeBuf.length + data.length); crcInput.set(typeBuf, 0); crcInput.set(data, typeBuf.length); const crc = crc32(crcInput); const crcBuf = new Uint8Array(4); new DataView(crcBuf.buffer).setUint32(0, crc); return Uint8Array.from([...lenBuf, ...typeBuf, ...data, ...crcBuf]); };
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const dv = new DataView(ihdrData.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdrData[8] = 8; ihdrData[9] = 2;
  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", new Uint8Array(0));
  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdr, off); off += ihdr.length;
  png.set(idat, off); off += idat.length;
  png.set(iend, off);
  return Buffer.from(png);
}

async function ensureProduct(tenantId: string, tenantSlug: string) {
  process.env.MULTI_TENANT_SCOPE = "off";

  // Toujours supprimer + recréer pour partir sur base propre
  const existing = await prisma.product.findFirst({
    where: { tenantId, reference: REFERENCE },
    select: { id: true },
  });
  if (existing) {
    console.log(`  → produit existant id=${existing.id} — suppression pour recréation propre`);
    await prisma.product.delete({ where: { id: existing.id } });
  }

  // Créer un produit minimal en base
  console.log("  → création du produit BJ en base…");

  // Trouver ou créer une couleur "Test"
  let color = await prisma.color.findFirst({
    where: { tenantId, name: "Test" },
    select: { id: true },
  });
  if (!color) {
    color = await prisma.color.create({
      data: { tenantId, name: "Test", hex: "#dd3c5a" },
      select: { id: true },
    });
    console.log(`    - couleur créée id=${color.id}`);
  }

  // Trouver ou créer une taille TU
  let size = await prisma.size.findFirst({
    where: { tenantId, name: "TU" },
    select: { id: true },
  });
  if (!size) {
    const maxPos = await prisma.size.findFirst({
      where: { tenantId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    size = await prisma.size.create({
      data: { tenantId, name: "TU", position: (maxPos?.position ?? 0) + 1 },
      select: { id: true },
    });
    console.log(`    - taille créée id=${size.id}`);
  }

  // Trouver ou créer une catégorie Test
  let category = await prisma.category.findFirst({
    where: { tenantId, name: "Test" },
    select: { id: true },
  });
  if (!category) {
    const maxPos = await prisma.category.findFirst({
      where: { tenantId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    category = await prisma.category.create({
      data: { tenantId, name: "Test", slug: "test", position: (maxPos?.position ?? 0) + 1 },
      select: { id: true },
    });
    console.log(`    - catégorie créée id=${category.id}`);
  }

  // Générer et écrire une image PNG test sur le disque
  const imgDir = path.join(process.cwd(), "public", "uploads", tenantSlug, "produits", REFERENCE.toLowerCase());
  await fs.mkdir(imgDir, { recursive: true });
  const imgFile = path.join(imgDir, "test-1.png");
  const imgDbPath = `/uploads/${tenantSlug}/produits/${REFERENCE.toLowerCase()}/test-1.png`;
  await fs.writeFile(imgFile, makeTestPng([210, 60, 90]));
  console.log(`    - image test générée sur ${imgFile}`);

  // Créer le produit d'abord, puis les relations en étapes séparées
  const product = await prisma.product.create({
    data: {
      tenant: { connect: { id: tenantId } },
      reference: REFERENCE,
      name: "Produit test Ankorstore (script)",
      description:
        "Produit de test créé par scripts/ankorstore-test-e2e-publish.ts. À archiver après vérification.",
      status: "ONLINE",
      category: { connect: { id: category.id } },
    },
    select: { id: true },
  });

  const productColor = await prisma.productColor.create({
    data: {
      tenant: { connect: { id: tenantId } },
      product: { connect: { id: product.id } },
      color: { connect: { id: color.id } },
      saleType: "UNIT",
      unitPrice: 3,
      stock: 1,
      weight: 50,
    },
    select: { id: true },
  });

  await prisma.variantSize.create({
    data: {
      tenant: { connect: { id: tenantId } },
      productColor: { connect: { id: productColor.id } },
      size: { connect: { id: size.id } },
      quantity: 1,
    },
  });

  await prisma.productColorImage.create({
    data: {
      tenant: { connect: { id: tenantId } },
      product: { connect: { id: product.id } },
      color: { connect: { id: color.id } },
      path: imgDbPath,
      order: 0,
    },
  });
  console.log(`    - produit BJ créé id=${product.id}`);
  return product.id;
}

async function main() {
  console.log("=".repeat(72));
  console.log("  Test bout-en-bout : Publier PRODUCTTESTANKORSTORE sur Ankorstore");
  console.log("=".repeat(72));

  // Trouver le tenant Beli & Jolie
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "beli-jolie" },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) throw new Error("Tenant Beli & Jolie introuvable");
  console.log(`  Tenant : ${tenant.name} (id ${tenant.id})`);

  const productId = await ensureProduct(tenant.id, tenant.slug);
  console.log(`  BJ productId = ${productId}`);

  // Wrap tout dans tenantALS.run pour que le module bo trouve le bon tenant
  await tenantALS.run(tenant.id, async () => {
    // Nettoie d'abord tout produit Ankor existant avec cette référence
    console.log("");
    console.log("→ nettoyage préalable chez Ankor (archive des orphelins avec cette réf)…");
    const { findLinkCandidates, archiveProducts } = await import("@/lib/ankorstore-bo");
    const orphans = await findLinkCandidates(REFERENCE);
    if (orphans.length > 0) {
      console.log(`  ${orphans.length} produit(s) à archiver côté Ankor`);
      await archiveProducts(orphans.map((o) => o.product.id));
    } else {
      console.log("  aucun orphelin trouvé");
    }
    // Petit délai pour laisser l'index Ankor rafraîchir
    await new Promise((r) => setTimeout(r, 2000));

    console.log("");
    console.log("→ appel publishProductToAnkorstoreBo…");
    const { publishProductToAnkorstoreBo } = await import(
      "@/app/actions/admin/ankorstore-bo"
    );
    const res = await publishProductToAnkorstoreBo(productId);
    console.log("");
    if (res.success) {
      console.log("✅ RÉUSSI");
      console.log(`  Ankor productId : ${res.ankorProductId}`);
      const updated = await prisma.product.findUnique({
        where: { id: productId },
        select: { ankorsProductId: true },
      });
      console.log(`  BJ ankorsProductId : ${updated?.ankorsProductId}`);
    } else {
      console.log("❌ ÉCHEC");
      console.log(`  Erreur : ${res.error}`);
    }
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Exception :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
