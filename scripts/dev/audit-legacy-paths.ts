/**
 * Audit des paths legacy (non-scopés par tenant).
 *
 * Compte, dans chaque table qui stocke un chemin fichier, combien de rows
 * ont un `path`/`filePath`/`image` qui NE CONTIENT PAS de slug de boutique
 * (`beli-jolie` ou `demo`). Ces rows sont soit :
 *   - des restes de la migration (à corriger)
 *   - des uploads récents faits sans passer par `withTenantSlug()` (bug applicatif)
 *
 * Usage :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/dev/audit-legacy-paths.ts
 *
 * NB : `MULTI_TENANT_SCOPE=off` est indispensable — sinon l'extension
 * Prisma filtre implicitement par tenant courant et masque les rows des autres
 * boutiques.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KNOWN_SLUGS = ["beli-jolie", "demo"] as const;

/**
 * Un path est considéré "scopé" s'il contient l'un des slugs connus.
 * Les path null/vides sont ignorés du compte legacy.
 */
function isLegacy(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = String(path);
  return !KNOWN_SLUGS.some((s) => p.includes(`/${s}/`));
}

async function auditTable<T extends { id: string }>(
  label: string,
  rows: (T & Record<string, string | null | undefined>)[],
  pathFields: (keyof T)[],
): Promise<{ legacy: number; total: number; samples: string[] }> {
  let legacyCount = 0;
  const samples: string[] = [];
  for (const row of rows) {
    for (const field of pathFields) {
      const v = row[field] as string | null | undefined;
      if (isLegacy(v)) {
        legacyCount++;
        if (samples.length < 3) samples.push(`${String(field)}=${v}`);
        break;
      }
    }
  }
  return { legacy: legacyCount, total: rows.length, samples };
}

async function auditClaimImages(): Promise<{
  legacy: number;
  total: number;
  samples: string[];
}> {
  const rows = await prisma.claimImage.findMany({
    select: { id: true, imagePath: true },
  });
  let legacyCount = 0;
  const samples: string[] = [];
  for (const r of rows) {
    if (isLegacy(r.imagePath)) {
      legacyCount++;
      if (samples.length < 3) samples.push(`${r.imagePath}`);
    }
  }
  return { legacy: legacyCount, total: rows.length, samples };
}

async function main() {
  if (process.env.MULTI_TENANT_SCOPE !== "off") {
    console.warn(
      "\n[!] MULTI_TENANT_SCOPE=off n'est pas positionné.\n" +
        "    L'audit ne verra QUE les rows du tenant courant (sans header, aucun).\n" +
        "    Relancez avec : MULTI_TENANT_SCOPE=off npx tsx scripts/dev/audit-legacy-paths.ts\n",
    );
  }

  console.log(`\nAudit des paths legacy (non-scopés par tenant).\n`);
  console.log(`Slugs connus (considérés scopés) : ${KNOWN_SLUGS.join(", ")}\n`);
  console.log(
    `Table                    | legacy /  total | échantillons`,
  );
  console.log(
    `-------------------------+-----------------+------------------------------`,
  );

  // 1. ProductColorImage.path
  const imgs = await prisma.productColorImage.findMany({
    select: { id: true, path: true },
  });
  const imgRes = await auditTable("ProductColorImage", imgs, ["path"]);
  console.log(
    `ProductColorImage.path   | ${String(imgRes.legacy).padStart(6)} / ${String(imgRes.total).padStart(6)}  | ${imgRes.samples.join(" ; ")}`,
  );

  // 2. Collection.image
  const cols = await prisma.collection.findMany({
    select: { id: true, image: true },
  });
  const colRes = await auditTable("Collection", cols, ["image"]);
  console.log(
    `Collection.image         | ${String(colRes.legacy).padStart(6)} / ${String(colRes.total).padStart(6)}  | ${colRes.samples.join(" ; ")}`,
  );

  // 3. User.kbisPath + documentPath
  const users = await prisma.user.findMany({
    select: { id: true, kbisPath: true, documentPath: true },
  });
  const userRes = await auditTable("User", users, ["kbisPath", "documentPath"]);
  console.log(
    `User.kbis+doc            | ${String(userRes.legacy).padStart(6)} / ${String(userRes.total).padStart(6)}  | ${userRes.samples.join(" ; ")}`,
  );

  // 4. SiteConfig.value (clés qui stockent des paths)
  const PATH_KEYS = [
    "site_logo_url",
    "favicon_image",
    "banner_image",
    "banner_mobile_image",
    "og_default_image",
  ];
  const configs = await prisma.siteConfig.findMany({
    where: { key: { in: PATH_KEYS } },
    select: { key: true, value: true },
  });
  let cfgLegacy = 0;
  const cfgSamples: string[] = [];
  for (const c of configs) {
    if (isLegacy(c.value)) {
      cfgLegacy++;
      if (cfgSamples.length < 3) cfgSamples.push(`${c.key}=${c.value}`);
    }
  }
  console.log(
    `SiteConfig.value (paths) | ${String(cfgLegacy).padStart(6)} / ${String(configs.length).padStart(6)}  | ${cfgSamples.join(" ; ")}`,
  );

  // 5. Order.invoicePath + creditNotePath
  const orders = await prisma.order.findMany({
    select: { id: true, invoicePath: true, creditNotePath: true },
  });
  const ordRes = await auditTable("Order", orders, [
    "invoicePath",
    "creditNotePath",
  ]);
  console.log(
    `Order.invoice+credit     | ${String(ordRes.legacy).padStart(6)} / ${String(ordRes.total).padStart(6)}  | ${ordRes.samples.join(" ; ")}`,
  );

  // 6. ClaimImage.imagePath
  const claimRes = await auditClaimImages();
  console.log(
    `ClaimImage.imagePath     | ${String(claimRes.legacy).padStart(6)} / ${String(claimRes.total).padStart(6)}  | ${claimRes.samples.join(" ; ")}`,
  );

  // 7. MessageAttachment.filePath
  const msgs = await prisma.messageAttachment.findMany({
    select: { id: true, filePath: true },
  });
  const msgRes = await auditTable("MessageAttachment", msgs, ["filePath"]);
  console.log(
    `MessageAttachment.file   | ${String(msgRes.legacy).padStart(6)} / ${String(msgRes.total).padStart(6)}  | ${msgRes.samples.join(" ; ")}`,
  );

  // 8. ImportJob.filePath
  const imports = await prisma.importJob.findMany({
    select: { id: true, filePath: true },
  });
  const impRes = await auditTable("ImportJob", imports, ["filePath"]);
  console.log(
    `ImportJob.filePath       | ${String(impRes.legacy).padStart(6)} / ${String(impRes.total).padStart(6)}  | ${impRes.samples.join(" ; ")}`,
  );

  // 9. LegalDocumentVersion : filePath n'existe pas d'après migrate-uploads-to-tenant
  //    (contenu inline). On saute.

  // 10. ImageProcessingJob.destDir + dbPath : peut être scopé ou pas
  const jobs = await prisma.imageProcessingJob.findMany({
    select: { id: true, destDir: true, dbPath: true, status: true },
    where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
  });
  const jobRes = await auditTable("ImageProcessingJob", jobs, [
    "destDir",
    "dbPath",
  ]);
  console.log(
    `ImageProcessingJob (30j) | ${String(jobRes.legacy).padStart(6)} / ${String(jobRes.total).padStart(6)}  | ${jobRes.samples.join(" ; ")}`,
  );

  console.log();
  const totalLegacy =
    imgRes.legacy +
    colRes.legacy +
    userRes.legacy +
    cfgLegacy +
    ordRes.legacy +
    claimRes.legacy +
    msgRes.legacy +
    impRes.legacy +
    jobRes.legacy;
  if (totalLegacy === 0) {
    console.log(`OK - Aucun path legacy trouvé sur ces tables.`);
  } else {
    console.log(
      `[!] ${totalLegacy} paths legacy détectés au total. Vérifiez la source des uploads (worker images, uploads produits, etc.)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
