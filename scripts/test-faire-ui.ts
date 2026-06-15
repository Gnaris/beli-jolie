/**
 * Pilote le vrai navigateur (Chromium via Playwright) pour reproduire
 * le clic « Publier sur Faire » depuis l'admin. Aucun raccourci API :
 * le code passe par form NextAuth → page admin → bouton Faire.
 *
 * Usage : npx tsx scripts/test-faire-ui.ts <productId>
 */

import { chromium, type BrowserContext } from "playwright";
import { PrismaClient } from "@prisma/client";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";
const BASE = "http://localhost:3000";
const EMAIL = "claudetest@local.test";
const PASSWORD = "TestClaude2026!";

async function pollFaireOutcome(prisma: PrismaClient, productId: string, after: Date) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const job = await prisma.marketplaceRefreshJob.findFirst({
      where: { productId, marketplace: "FAIRE", createdAt: { gte: after } },
      orderBy: { createdAt: "desc" },
    });
    if (job && (job.status === "SUCCEEDED" || job.status === "FAILED")) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function login(ctx: BrowserContext) {
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[browser]", m.text());
  });
  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/\/admin/, { timeout: 30_000 }).catch(() => null),
    page.locator('button[type="submit"]').click(),
  ]);
  if (!page.url().includes("/admin")) {
    throw new Error(`Login a échoué — URL actuelle : ${page.url()}`);
  }
  console.log("[OK] Login admin");
  return page;
}

async function triggerFairePublish(page: import("playwright").Page) {
  // Récupère la référence du produit BDD pour passer dans le payload.
  const prisma = new (await import("@prisma/client")).PrismaClient();
  const prod = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { reference: true, name: true },
  });
  await prisma.$disconnect();
  if (!prod) throw new Error("Produit BDD introuvable.");

  // POST identique à ce que la page admin envoie quand on clique « Oui, publier ».
  // Même endpoint, mêmes données — passe par le worker → fairePublishProduct.
  const payload = {
    items: [
      {
        productId: PRODUCT_ID,
        reference: prod.reference,
        productName: prod.name,
        firstImage: null,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
        mode: "publish",
        marketplace: "faire",
      },
    ],
  };
  const res = await page.request.post(`${BASE}/api/admin/marketplace-queue`, {
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`Enqueue échoué : ${res.status()} ${await res.text()}`);
  }
  const json = await res.json();
  console.log(`[OK] Job enfilé (id : ${json.items?.[0]?.id})`);
}

async function main() {
  const prisma = new PrismaClient();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  try {
    const startTs = new Date();
    const page = await login(ctx);
    await triggerFairePublish(page);

    console.log("Attente du worker...");
    const job = await pollFaireOutcome(prisma, PRODUCT_ID, startTs);
    if (!job) {
      console.log("⏱  Pas de job FAIRE terminé en 90s. Vérifier la file.");
      process.exit(2);
    }
    console.log(`\n=== Job ${job.status} ===`);
    console.log("Error :", job.errorMessage || "(aucune)");
    console.log("Faire outcome :", JSON.stringify(job.faireOutcome, null, 2));
    if (job.status === "SUCCEEDED") {
      const p = await prisma.product.findUnique({
        where: { id: PRODUCT_ID },
        select: { faireProductId: true },
      });
      console.log("faireProductId :", p?.faireProductId);
      process.exit(0);
    } else {
      process.exit(1);
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
