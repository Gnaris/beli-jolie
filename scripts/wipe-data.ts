/**
 * Vide la base de donnees et le stockage local du site, a l'exception :
 *   - du compte ADMIN (User role = ADMIN) -- les comptes CLIENT sont supprimes
 *   - de la table SiteConfig (parametres)
 *   - de la table TranslationQuota (compteur DeepL)
 *   - de la table CompanyInfo (fiche societe : raison sociale, SIRET, adresse, etc.)
 *   - des tables LegalDocument et LegalDocumentVersion (CGV, CGU, mentions legales, etc.)
 *   - de l'arborescence de dossiers public/uploads et private/uploads
 *     (les dossiers eux-memes sont preserves, leur contenu est efface)
 *
 * Le fichier `kbisPath` du compte ADMIN est conserve s'il existe physiquement.
 *
 * Usage :
 *   npx tsx scripts/wipe-data.ts
 *
 * Aucune confirmation interactive : la commande s'execute immediatement.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------
// Types
// ---------------------------------------------

export interface PrismaLike {
  user: {
    findFirst: (args: { where: { role: "ADMIN" | "CLIENT" } }) => Promise<
      { id: string; email: string; kbisPath: string | null } | null
    >;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<Array<Record<string, unknown>>>;
  $disconnect: () => Promise<unknown>;
}

export interface CountReport {
  [model: string]: number;
}

export interface PurgeUploadsOptions {
  /** Racine du projet (par defaut : process.cwd()) */
  cwd?: string;
  /** Chemin absolu d'un fichier admin a conserver (kbis) */
  preserveFile?: string | null;
  /** Logger optionnel pour les messages */
  log?: (msg: string) => void;
  /** Permet d'injecter un fs alternatif pour les tests */
  fsImpl?: {
    readdir: typeof fs.readdir;
    rm: typeof fs.rm;
    stat: typeof fs.stat;
    mkdir: typeof fs.mkdir;
  };
}

// ---------------------------------------------
// Liste des dossiers d'uploads a vider
//   "key" = chemin relatif depuis la racine projet
// ---------------------------------------------

export const UPLOAD_DIRS: string[] = [
  "public/uploads/produits",
  "public/uploads/collections",
  "public/uploads/motifs-couleurs",
  "public/uploads/banniere",
  "public/uploads/catalogues",
  "public/uploads/bordereaux",
  "public/uploads/reclamations",
  "public/uploads/temp",
  "private/uploads/kbis",
  "private/uploads/documents",
  "private/uploads/factures",
  "private/uploads/avoirs",
  "private/uploads/reclamations",
  "private/uploads/import-jobs",
  "private/uploads/pieces-jointes-email",
];

// ---------------------------------------------
// Tables conservees integralement
// ---------------------------------------------

export const KEEP_TABLES = [
  "SiteConfig",
  "TranslationQuota",
  "CompanyInfo",
  "LegalDocument",
  "LegalDocumentVersion",
] as const;

// ---------------------------------------------
// Tables a vider -- ordre topologique (enfants avant parents)
// Note : avec FOREIGN_KEY_CHECKS=0 l'ordre n'est plus critique pour le succes,
// mais on le maintient propre pour pouvoir lister sans surprise et pour la doc.
// ---------------------------------------------

export const TABLES_TO_CLEAR: string[] = [
  // Analytics
  "ProductView",
  "PriceHistory",
  // Stock
  "StockMovement",
  // Favoris
  "Favorite",
  // Catalogues partageables
  "CatalogProduct",
  "Catalog",
  // Collections
  "CollectionProduct",
  "CollectionTranslation",
  "Collection",
  // Panier
  "CartItem",
  "Cart",
  // Promotions
  "PromotionUsage",
  "PromotionProduct",
  "PromotionCategory",
  "PromotionCollection",
  "Promotion",
  // Avoirs
  "CreditUsage",
  "Credit",
  // SAV / Reclamations
  "ClaimItem",
  "ClaimImage",
  "ClaimReturn",
  "ClaimReship",
  "Claim",
  // Messagerie
  "MessageAttachment",
  "Message",
  "Conversation",
  // Commandes
  "OrderItemModification",
  "OrderItem",
  "Order",
  // Stripe
  "StripeWebhookEvent",
  // Imports
  "ImportJob",
  "ImportDraft",
  // Securite / auth transitoire
  "PasswordResetToken",
  "LoginOtp",
  "LoginAttempt",
  "AccountLockout",
  "RegistrationLog",
  // Liens en attente
  "PendingSimilar",
  // Adresses (rattachees aux users CLIENT)
  "ShippingAddress",
  // Produits
  "PackColorLineSize",
  "PackColorLine",
  "VariantSize",
  "ProductColorImage",
  "ProductColor",
  "ProductBundle",
  "ProductSimilar",
  "ProductTag",
  "ProductTranslation",
  "ProductComposition",
  "_ProductSubCategories", // table de jointure implicite Prisma
  "Product",
  // Referentiels
  "TagTranslation",
  "Tag",
  "CompositionTranslation",
  "Composition",
  "SeasonTranslation",
  "Season",
  "ManufacturingCountryTranslation",
  "ManufacturingCountry",
  "ColorTranslation",
  "Color",
  "SubCategoryTranslation",
  "SubCategory",
  "CategoryTranslation",
  "Category",
  // Tailles
  "Size",
];

// ---------------------------------------------
// Sanity checks sur la liste
// ---------------------------------------------

/**
 * Verifie qu'aucune table conservee ni le User ne se retrouvent par erreur
 * dans la liste a vider. Renvoie la liste des conflits trouves (vide = OK).
 */
export function validateTableLists(
  toClear: readonly string[] = TABLES_TO_CLEAR,
  toKeep: readonly string[] = KEEP_TABLES,
): string[] {
  const protectedSet = new Set([...toKeep.map((t) => t.toLowerCase()), "user"]);
  const conflicts: string[] = [];
  for (const t of toClear) {
    if (protectedSet.has(t.toLowerCase())) {
      conflicts.push(t);
    }
  }
  return conflicts;
}

// ---------------------------------------------
// Comptage avant action
// ---------------------------------------------

export async function countBeforeWipe(prisma: PrismaLike): Promise<CountReport> {
  const report: CountReport = {};

  for (const table of TABLES_TO_CLEAR) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM \`${table}\``);
      const first = rows[0];
      const c = first?.c ?? 0;
      const n = typeof c === "bigint" ? Number(c) : Number(c);
      report[table] = Number.isFinite(n) ? n : 0;
    } catch {
      // Table inexistante en local (ex: legacy retiree) : on l'ignore.
      report[table] = -1;
    }
  }

  try {
    report["User (CLIENT a supprimer)"] = await prisma.user.count({ where: { role: "CLIENT" } });
    report["User (ADMIN conserves)"] = await prisma.user.count({ where: { role: "ADMIN" } });
  } catch {
    // ignore
  }

  return report;
}

// ---------------------------------------------
// Purge BDD
// ---------------------------------------------

export interface PurgeDatabaseResult {
  clearedTables: string[];
  failedTables: Array<{ table: string; error: string }>;
  deletedClients: number;
  preservedAdminId: string | null;
  preservedKbisPath: string | null;
}

export async function purgeDatabase(
  prisma: PrismaLike,
  log: (msg: string) => void = () => {},
): Promise<PurgeDatabaseResult> {
  const conflicts = validateTableLists();
  if (conflicts.length > 0) {
    throw new Error(
      `Configuration invalide : tables protegees presentes dans TABLES_TO_CLEAR -> ${conflicts.join(", ")}`,
    );
  }

  // 1. Reperer l'admin a preserver
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    log("Avertissement : aucun compte ADMIN trouve. La suppression continue mais aucun User ne sera conserve.");
  } else {
    log(`Compte ADMIN preserve : ${admin.email} (id=${admin.id})`);
  }

  // 2. Desactiver les FK le temps du wipe (MySQL)
  log("Desactivation des contraintes de cles etrangeres...");
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");

  const cleared: string[] = [];
  const failed: Array<{ table: string; error: string }> = [];
  let deletedClients = 0;

  try {
    // 3. Truncate de chaque table metier
    for (const table of TABLES_TO_CLEAR) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
        log(`  Videe  ${table}`);
        cleared.push(table);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`  ERREUR ${table} -> ${msg}`);
        failed.push({ table, error: msg });
      }
    }

    // 4. Supprimer les Users non-ADMIN
    try {
      const res = await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
      deletedClients = res.count;
      log(`  Videe  User (CLIENT) -> ${deletedClients} ligne(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ERREUR User (CLIENT) -> ${msg}`);
      failed.push({ table: "User (CLIENT)", error: msg });
    }

    return {
      clearedTables: cleared,
      failedTables: failed,
      deletedClients,
      preservedAdminId: admin?.id ?? null,
      preservedKbisPath: admin?.kbisPath ?? null,
    };
  } finally {
    // 5. Reactiver les FK (toujours, meme en cas d'erreur)
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    log("Contraintes de cles etrangeres reactivees.");
  }
}

// ---------------------------------------------
// Purge filesystem
// ---------------------------------------------

export interface PurgeUploadsResult {
  perDir: Array<{ dir: string; deletedFiles: number; deletedDirs: number; skipped: boolean; error?: string }>;
  preservedFiles: string[];
}

/**
 * Vide recursivement le contenu d'un dossier (mais pas le dossier lui-meme),
 * en preservant un fichier optionnel.
 */
export async function emptyDirectory(
  dirAbs: string,
  preserveFile: string | null,
  fsImpl: NonNullable<PurgeUploadsOptions["fsImpl"]>,
): Promise<{ deletedFiles: number; deletedDirs: number; skipped: boolean }> {
  let stat: Awaited<ReturnType<typeof fsImpl.stat>>;
  try {
    stat = await fsImpl.stat(dirAbs);
  } catch {
    // Dossier inexistant : on le cree vide pour preserver l'arbo et on s'arrete la.
    await fsImpl.mkdir(dirAbs, { recursive: true });
    return { deletedFiles: 0, deletedDirs: 0, skipped: true };
  }
  if (!stat.isDirectory()) {
    return { deletedFiles: 0, deletedDirs: 0, skipped: true };
  }

  const entries = await fsImpl.readdir(dirAbs, { withFileTypes: true });
  const preserveAbs = preserveFile ? path.resolve(preserveFile) : null;

  let deletedFiles = 0;
  let deletedDirs = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirAbs, entry.name);
    const entryAbs = path.resolve(entryPath);
    if (preserveAbs && entryAbs === preserveAbs) {
      continue; // fichier admin a preserver
    }
    try {
      if (entry.isDirectory()) {
        await fsImpl.rm(entryPath, { recursive: true, force: true });
        deletedDirs++;
      } else {
        await fsImpl.rm(entryPath, { force: true });
        deletedFiles++;
      }
    } catch {
      // ignore : fichier verrouille / deja supprime
    }
  }

  return { deletedFiles, deletedDirs, skipped: false };
}

export async function purgeUploads(
  options: PurgeUploadsOptions = {},
): Promise<PurgeUploadsResult> {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? (() => {});
  const fsImpl = options.fsImpl ?? {
    readdir: fs.readdir,
    rm: fs.rm,
    stat: fs.stat,
    mkdir: fs.mkdir,
  };
  const preserve = options.preserveFile ? path.resolve(options.preserveFile) : null;

  const preserved: string[] = [];
  const perDir: PurgeUploadsResult["perDir"] = [];

  for (const rel of UPLOAD_DIRS) {
    const abs = path.resolve(cwd, rel);
    try {
      const r = await emptyDirectory(abs, preserve, fsImpl);
      if (r.skipped) {
        log(`  Ignore ${rel} (dossier absent -- recree vide)`);
      } else {
        log(`  Vide   ${rel} -> ${r.deletedFiles} fichier(s), ${r.deletedDirs} dossier(s)`);
      }
      perDir.push({ dir: rel, deletedFiles: r.deletedFiles, deletedDirs: r.deletedDirs, skipped: r.skipped });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ERREUR ${rel} -> ${msg}`);
      perDir.push({ dir: rel, deletedFiles: 0, deletedDirs: 0, skipped: true, error: msg });
    }
  }

  if (preserve) {
    try {
      await fsImpl.stat(preserve);
      preserved.push(preserve);
    } catch {
      // fichier inexistant : rien a preserver concretement
    }
  }

  return { perDir, preservedFiles: preserved };
}

// ---------------------------------------------
// Helpers CLI
// ---------------------------------------------

export function databaseNameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Format attendu : mysql://user:pass@host:port/dbname?args
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\//, "");
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function formatCountReport(report: CountReport): string {
  const entries = Object.entries(report)
    .filter(([, n]) => n !== 0 && n !== -1)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "  (aucune donnee a supprimer)";
  return entries.map(([k, n]) => `  ${k.padEnd(40)} ${n.toString().padStart(8)} ligne(s)`).join("\n");
}

// ---------------------------------------------
// Main
// ---------------------------------------------

async function main() {
  const prisma = new PrismaClient() as unknown as PrismaLike;

  console.log("\n========================================");
  console.log("   EFFACEMENT DES DONNEES (DESTRUCTIF)");
  console.log("========================================\n");
  console.log("Sera CONSERVE :");
  console.log("  - le compte ADMIN (User role=ADMIN)");
  console.log("  - les parametres (SiteConfig)");
  console.log("  - le compteur DeepL (TranslationQuota)");
  console.log("  - la fiche societe (CompanyInfo : raison sociale, SIRET, adresse, etc.)");
  console.log("  - les documents legaux (LegalDocument + LegalDocumentVersion : CGV, CGU, mentions legales, etc.)");
  console.log("  - l'arborescence des dossiers public/uploads et private/uploads (vides mais conserves)");
  console.log("\nSera SUPPRIME :");
  console.log("  - tous les produits, commandes, paniers, favoris, SAV, messages");
  console.log("  - tous les comptes CLIENT et leurs adresses");
  console.log("  - tous les fichiers contenus dans les dossiers d'uploads (sauf le KBIS du compte admin)");
  console.log("");

  // 1. Recap
  console.log("Decompte des donnees existantes (peut prendre quelques secondes)...");
  const report = await countBeforeWipe(prisma);
  console.log("\nRecapitulatif :");
  console.log(formatCountReport(report));
  console.log("");

  // Plus de confirmation interactive : lancement immediat.
  console.log("Lancement de l'effacement...\n");

  // 4. Purge BDD
  console.log("--- Suppression des donnees en base ---");
  const dbResult = await purgeDatabase(prisma, (m) => console.log(m));

  // 5. Purge fichiers
  console.log("\n--- Vidage des dossiers d'uploads ---");
  const preserveFile = dbResult.preservedKbisPath
    ? path.resolve(process.cwd(), dbResult.preservedKbisPath.replace(/^[/\\]+/, ""))
    : null;
  if (preserveFile) {
    console.log(`Fichier admin preserve : ${preserveFile}`);
  }
  const fsResult = await purgeUploads({
    cwd: process.cwd(),
    preserveFile,
    log: (m) => console.log(m),
  });

  // 6. Recap final
  const totalDeletedFiles = fsResult.perDir.reduce((sum, d) => sum + d.deletedFiles, 0);
  const totalDeletedDirs = fsResult.perDir.reduce((sum, d) => sum + d.deletedDirs, 0);

  console.log("\n========================================");
  console.log("   Effacement termine");
  console.log("========================================");
  console.log(`Tables videes            : ${dbResult.clearedTables.length}/${TABLES_TO_CLEAR.length}`);
  console.log(`Tables en erreur         : ${dbResult.failedTables.length}`);
  console.log(`Comptes CLIENT supprimes : ${dbResult.deletedClients}`);
  console.log(`Fichiers supprimes       : ${totalDeletedFiles}`);
  console.log(`Sous-dossiers supprimes  : ${totalDeletedDirs}`);
  console.log(`Fichiers preserves       : ${fsResult.preservedFiles.length}`);
  if (dbResult.failedTables.length > 0) {
    console.log("\nErreurs :");
    for (const f of dbResult.failedTables) {
      console.log(`  - ${f.table} : ${f.error}`);
    }
  }
  console.log("");

  await prisma.$disconnect();
}

// Direct-execution pattern : ne lance main() que si le fichier est appele en CLI
const isDirectRun =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((e) => {
    console.error("\nErreur fatale :", e);
    process.exit(1);
  });
}
