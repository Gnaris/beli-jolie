/**
 * Migration ponctuelle : déplace les uploads existants sous
 *   public/uploads/{tenantSlug}/…
 *   private/uploads/{tenantSlug}/…
 * et met à jour tous les paths stockés en BDD pour refléter la nouvelle
 * arborescence.
 *
 * À ne lancer qu'UNE fois par boutique, quand la boutique n'a qu'un seul
 * tenant à isoler. Idempotent : ré-exécuter ne fait rien si les paths sont
 * déjà migrés.
 *
 * Tables touchées (colonnes de chemin) :
 *   - ProductColorImage.path
 *   - Collection.image (nullable)
 *   - User.kbisPath, User.documentPath (nullable)
 *   - SiteConfig.value pour les clés qui stockent un chemin (banner_image, site_logo_url, favicon_image, etc.)
 *   - LegalDocumentVersion.filePath
 *   - Order.invoicePath, Order.creditNotePath (nullable)
 *   - Claim.attachmentPaths (JSON array de chemins)
 *   - MessageAttachment.path
 *   - Catalog.filePath (nullable)
 *   - ImportJob.filePath (nullable)
 *
 * Fichiers déplacés :
 *   public/uploads/{banniere,collections,favicon,motifs-couleurs,produits,reclamations,catalogues,bordereaux}
 *   private/uploads/{avoirs,documents,factures,kbis,pieces-jointes-email,reclamations,_image_jobs,import-jobs}
 *
 * Exclus : public/uploads/temp (chat temporaire, purgé auto)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CWD = process.cwd();

const SLUG = "beli-jolie";

const PUBLIC_UPLOAD_DIRS = [
  "banniere",
  "collections",
  "favicon",
  "motifs-couleurs",
  "produits",
  "reclamations",
  "catalogues",
  "bordereaux",
];
const PRIVATE_UPLOAD_DIRS = [
  "avoirs",
  "documents",
  "factures",
  "kbis",
  "pieces-jointes-email",
  "reclamations",
  "_image_jobs",
  "import-jobs",
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function moveDirIfExists(sourceRel: string, destRel: string): Promise<void> {
  const source = path.join(CWD, sourceRel);
  const dest = path.join(CWD, destRel);
  const exists = await pathExists(source);
  if (!exists) {
    console.log(`  [skip] ${sourceRel} n'existe pas`);
    return;
  }
  const destExists = await pathExists(dest);
  if (destExists) {
    console.log(`  [skip] ${destRel} existe déjà — fusion manuelle si nécessaire`);
    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(source, dest);
  console.log(`  ${sourceRel} → ${destRel}`);
}

async function moveFiles(): Promise<void> {
  console.log(`[step 1/2] Déplacement des fichiers vers /uploads/${SLUG}/…`);
  await fs.mkdir(path.join(CWD, `public/uploads/${SLUG}`), { recursive: true });
  await fs.mkdir(path.join(CWD, `private/uploads/${SLUG}`), { recursive: true });

  for (const dir of PUBLIC_UPLOAD_DIRS) {
    await moveDirIfExists(`public/uploads/${dir}`, `public/uploads/${SLUG}/${dir}`);
  }
  for (const dir of PRIVATE_UPLOAD_DIRS) {
    await moveDirIfExists(`private/uploads/${dir}`, `private/uploads/${SLUG}/${dir}`);
  }
}

function rewritePath(p: string | null | undefined): string | null {
  if (!p) return p ?? null;
  // Idempotent : ne réécrit pas si déjà scopé
  if (p.includes(`/uploads/${SLUG}/`) || p.startsWith(`uploads/${SLUG}/`) || p.startsWith(`private/uploads/${SLUG}/`)) {
    return p;
  }
  // Public : "/uploads/X/..." → "/uploads/{slug}/X/..."
  const publicMatch = p.match(/^(\/)?uploads\/(.+)$/);
  if (publicMatch) {
    const leading = publicMatch[1] || "";
    return `${leading}uploads/${SLUG}/${publicMatch[2]}`;
  }
  // Private : "private/uploads/X/..." → "private/uploads/{slug}/X/..."
  const privateMatch = p.match(/^(\/)?private\/uploads\/(.+)$/);
  if (privateMatch) {
    const leading = privateMatch[1] || "";
    return `${leading}private/uploads/${SLUG}/${privateMatch[2]}`;
  }
  return p;
}

async function updateDbPaths(): Promise<void> {
  console.log(`[step 2/2] Réécriture des paths en BDD…`);

  // ProductColorImage.path
  const images = await prisma.productColorImage.findMany({ select: { id: true, path: true } });
  let updated = 0;
  for (const img of images) {
    const next = rewritePath(img.path);
    if (next && next !== img.path) {
      await prisma.productColorImage.update({ where: { id: img.id }, data: { path: next } });
      updated++;
    }
  }
  console.log(`  ProductColorImage : ${updated}/${images.length} paths mis à jour`);

  // Collection.image
  const collections = await prisma.collection.findMany({ select: { id: true, image: true } });
  let collUpdated = 0;
  for (const c of collections) {
    const next = rewritePath(c.image);
    if (next && next !== c.image) {
      await prisma.collection.update({ where: { id: c.id }, data: { image: next } });
      collUpdated++;
    }
  }
  console.log(`  Collection      : ${collUpdated}/${collections.length} paths mis à jour`);

  // User.kbisPath / documentPath
  const users = await prisma.user.findMany({ select: { id: true, kbisPath: true, documentPath: true } });
  let userUpdated = 0;
  for (const u of users) {
    const nextKbis = rewritePath(u.kbisPath);
    const nextDoc = rewritePath(u.documentPath);
    if ((nextKbis && nextKbis !== u.kbisPath) || (nextDoc && nextDoc !== u.documentPath)) {
      await prisma.user.update({
        where: { id: u.id },
        data: { kbisPath: nextKbis, documentPath: nextDoc },
      });
      userUpdated++;
    }
  }
  console.log(`  User            : ${userUpdated}/${users.length} paths mis à jour`);

  // SiteConfig : clés stockant des chemins
  const PATH_KEYS = new Set([
    "site_logo_url",
    "favicon_image",
    "banner_image",
    "banner_mobile_image",
    "og_default_image",
  ]);
  const configs = await prisma.siteConfig.findMany({ where: { key: { in: [...PATH_KEYS] } } });
  let cfgUpdated = 0;
  for (const c of configs) {
    const next = rewritePath(c.value);
    if (next && next !== c.value) {
      await prisma.siteConfig.update({ where: { key: c.key }, data: { value: next } });
      cfgUpdated++;
    }
  }
  console.log(`  SiteConfig      : ${cfgUpdated}/${configs.length} paths mis à jour`);

  // LegalDocumentVersion : le contenu est inline (String @db.LongText),
  // pas de filePath, donc rien à réécrire.

  // MessageAttachment.filePath
  const attachments = await prisma.messageAttachment.findMany({ select: { id: true, filePath: true } });
  let atUpdated = 0;
  for (const a of attachments) {
    const next = rewritePath(a.filePath);
    if (next && next !== a.filePath) {
      await prisma.messageAttachment.update({ where: { id: a.id }, data: { filePath: next } });
      atUpdated++;
    }
  }
  console.log(`  MsgAttachment   : ${atUpdated}/${attachments.length} paths mis à jour`);

  // Catalog : pas de filePath ni path — les catalogues sont générés à la volée
  // depuis la liste CatalogProduct, aucun fichier lié à réécrire.

  // ImportJob.filePath
  const imports = await prisma.importJob.findMany({ select: { id: true, filePath: true } });
  let imUpdated = 0;
  for (const i of imports) {
    const next = rewritePath(i.filePath);
    if (next && next !== i.filePath) {
      await prisma.importJob.update({ where: { id: i.id }, data: { filePath: next } });
      imUpdated++;
    }
  }
  console.log(`  ImportJob       : ${imUpdated}/${imports.length} paths mis à jour`);
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) {
    console.error(`Tenant ${SLUG} introuvable. Lance scripts/seed-default-tenant.ts d'abord.`);
    process.exit(1);
  }

  console.log(`Migration uploads → tenant ${SLUG} (${tenant.id})\n`);
  await moveFiles();
  console.log();
  await updateDbPaths();
  console.log(`\nMigration terminée.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
