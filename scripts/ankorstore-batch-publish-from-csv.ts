/**
 * Republication MASSIVE Ankorstore en BATCH (1 seule opération AS pour N produits).
 *
 * Pourquoi ce script existe : kickoffPublish/Refresh crée 1 opération AS par
 * produit. Or Ankorstore mutualise les ops "import" tant qu'aucune n'est
 * terminée → on récupère le même operationId sur 2 kickoffs successifs et le
 * Start renvoie 403. Ce script contourne en utilisant le mode batch natif d'AS :
 *   - 1 opération `import` créée
 *   - Tous les produits ajoutés en une fois (par chunks de 50)
 *   - Opération démarrée 1 seule fois
 *
 * Trade-off : on ne crée PAS de row `AnkorstoreOperation` côté nous. Le
 * webhook arrivera mais ne trouvera pas la row et loguera un warning bénin.
 *
 * Après que le webhook ait fini de tout traiter, lancer
 * `ankorstore-batch-publish-reconcile.ts` pour lier les nouveaux ankorsProductId.
 *
 * Modes :
 *   --dry-run (défaut) : aucun appel
 *   --apply            : envoi réel
 *   --limit=N          : limite de produits
 *   --shuffle          : mélange avant limite
 *
 * Usage :
 *   npx tsx scripts/ankorstore-batch-publish-from-csv.ts /tmp/drafts-export.csv --limit=20 --shuffle --apply
 */
import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
} from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { buildPublishProductInput } from "@/lib/ankorstore-publish";
import {
  ankorstoreCreateCatalogOperation,
  ankorstoreAddProductsToOperation,
  ankorstoreStartOperation,
  type AnkorstoreCatalogProductInput,
} from "@/lib/ankorstore-api-write";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const BATCH_SIZE = 50; // max accepté par AS

async function bootstrapAnkorstoreAuth(): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants.");
  }
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`OAuth Ankorstore HTTP ${resp.status}`);
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("Réponse OAuth invalide");
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
}

function parseCsvRefs(content: string): Set<string> {
  const refs = new Set<string>();
  let i = 0;
  const len = content.length;
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let rowIdx = 0;
  function pushField() { fields.push(current); current = ""; }
  function pushRow() {
    if (fields.length === 0 && current === "") return;
    pushField();
    if (rowIdx > 0 && fields.length >= 1) {
      const sku = fields[0].trim();
      const idx = sku.indexOf("_");
      const ref = idx > 0 ? sku.slice(0, idx).trim() : sku.trim();
      if (ref) refs.add(ref);
    }
    rowIdx++;
    fields = [];
  }
  while (i < len) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { current += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      current += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushField(); i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { pushRow(); i++; continue; }
    current += ch; i++;
  }
  pushRow();
  return refs;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const doShuffle = args.includes("--shuffle");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

  if (!csvPath) throw new Error("Usage : <csv> [--limit=N] [--shuffle] [--apply]");
  if (!fs.existsSync(csvPath)) throw new Error(`Fichier introuvable : ${csvPath}`);

  console.log(`[Batch Publish] Mode : ${apply ? "APPLY" : "DRY-RUN"}`);
  if (Number.isFinite(limit)) console.log(`Limite : ${limit}`);
  if (doShuffle) console.log(`Mélange : oui`);
  console.log();

  const refsFromCsv = parseCsvRefs(fs.readFileSync(csvPath, "utf-8"));
  console.log(`Refs CSV uniques : ${refsFromCsv.size}`);

  const refsArray = Array.from(refsFromCsv);
  const products = await prisma.product.findMany({
    where: {
      reference: { in: refsArray },
      status: { not: "ARCHIVED" },
    },
    select: { id: true, reference: true, name: true, ankorsProductId: true },
  });
  console.log(`Refs présentes en BDD (non archivées) : ${products.length}`);

  await bootstrapAnkorstoreAuth();
  console.log("✓ Auth AS OK\n");

  const selection = doShuffle ? shuffle(products) : products;
  const subset = selection.slice(0, Math.min(limit, selection.length));
  console.log(`Construction des payloads pour ${subset.length} produits...\n`);

  // Build inputs (skip ceux qui ne peuvent pas être publiés)
  const inputs: { reference: string; productId: string; input: AnkorstoreCatalogProductInput }[] = [];
  const buildErrors: { reference: string; error: string }[] = [];
  for (const p of subset) {
    const built = await buildPublishProductInput(p.id);
    if (built.ok) {
      inputs.push({ reference: p.reference, productId: p.id, input: built.input });
    } else {
      buildErrors.push({ reference: p.reference, error: built.error });
    }
  }
  console.log(`Payloads construits : ${inputs.length}`);
  console.log(`Échecs construction  : ${buildErrors.length}`);
  if (buildErrors.length > 0) {
    console.log("Échecs (10 premiers) :");
    for (const e of buildErrors.slice(0, 10)) {
      console.log(`  ${e.reference.padEnd(14)} ${e.error.slice(0, 80)}`);
    }
  }
  console.log();

  if (!apply) {
    console.log(`Dry-run : ${inputs.length} produits seraient envoyés en 1 batch.`);
    console.log(`(Aucune requête envoyée à Ankorstore.)`);
    return;
  }

  if (inputs.length === 0) {
    console.log("Aucun payload à envoyer.");
    return;
  }

  console.log(`=== ENVOI BATCH À ANKORSTORE ===\n`);

  // 1. Créer l'opération
  console.log("→ Création de l'opération import...");
  const { operationId } = await ankorstoreCreateCatalogOperation("import");
  console.log(`  operationId : ${operationId}`);

  // 2. Ajouter les produits par chunks de BATCH_SIZE
  console.log(`\n→ Ajout des ${inputs.length} produits (chunks de ${BATCH_SIZE})...`);
  let totalAcked = 0;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const chunk = inputs.slice(i, i + BATCH_SIZE);
    const resp = await ankorstoreAddProductsToOperation(
      operationId,
      chunk.map((c) => c.input),
    );
    totalAcked += resp.totalProductsCount;
    console.log(`  Chunk ${Math.floor(i / BATCH_SIZE) + 1} : ${chunk.length} envoyés, ${resp.totalProductsCount} acked (cumul ${totalAcked})`);
  }

  // 3. Démarrer
  console.log(`\n→ Démarrage de l'opération...`);
  try {
    await ankorstoreStartOperation(operationId);
    console.log(`  ✓ Démarrée. Ankorstore validera en arrière-plan.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ Start failed : ${msg.slice(0, 200)}`);
    console.log(`  (L'opération reste en file d'attente AS — sera lancée quand la précédente sera terminée.)`);
  }

  // 4. Log final
  const logPath = `/var/log/ankorstore-batch-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.json`;
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        operationId,
        productsSent: inputs.length,
        productsAcked: totalAcked,
        buildErrors,
        productRefs: inputs.map((i) => i.reference),
      },
      null,
      2,
    ),
  );
  console.log(`\nRésumé : ${logPath}`);
  console.log(`OperationId : ${operationId}`);
  console.log(`\nIMPORTANT : Le webhook AS validera les produits 1 par 1.`);
  console.log(`Les produits qui passent la validation deviendront de vrais produits AS.`);
  console.log(`Les autres seront re-créés en brouillon avec leurs erreurs précises.`);
  console.log(`Surveiller le dashboard Ankorstore pour voir le compteur de brouillons baisser.`);
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
