/**
 * Ankorstore Orders API — sonde en lecture seule.
 *
 * But : vérifier que l'endpoint /api/v1/orders répond, comprendre la forme
 * exacte des données (JSON:API) et sauvegarder la réponse brute pour caler
 * le modèle Prisma et le sync.
 *
 * ⚠️ 100 % READ-ONLY : aucun POST/PATCH/DELETE, aucune écriture BDD.
 *
 * Usage :
 *   npx tsx scripts/ankorstore-orders-probe.ts             # tous les tenants
 *   npx tsx scripts/ankorstore-orders-probe.ts <slug>      # 1 tenant précis
 *
 * Sortie :
 *   - console : résumé de la réponse (nb commandes, statuts, structure)
 *   - fichier : scripts/.ankorstore-orders-probe/<slug>-list.json
 *              scripts/.ankorstore-orders-probe/<slug>-detail.json
 */
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const BASE_URL = "https://www.ankorstore.com/api/v1";
const OUT_DIR = path.join(process.cwd(), "scripts", ".ankorstore-orders-probe");

interface TenantCreds {
  tenantId: string;
  slug: string;
  name: string;
  clientId: string;
  clientSecret: string;
}

async function loadTenantsCreds(filterSlug?: string): Promise<TenantCreds[]> {
  const tenants = await prisma.tenant.findMany({
    where: filterSlug ? { slug: filterSlug } : { isActive: true },
    select: { id: true, slug: true, name: true },
  });
  const results: TenantCreds[] = [];
  for (const t of tenants) {
    const rows = await prisma.siteConfig.findMany({
      where: {
        tenantId: t.id,
        key: { in: ["ankors_client_id", "ankors_client_secret"] },
      },
    });
    const map = new Map(
      rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
    );
    const clientId = map.get("ankors_client_id");
    const clientSecret = map.get("ankors_client_secret");
    if (!clientId || !clientSecret) {
      console.log(`  [${t.slug}] pas d'identifiants Ankorstore — ignoré`);
      continue;
    }
    results.push({
      tenantId: t.id,
      slug: t.slug,
      name: t.name,
      clientId,
      clientSecret,
    });
  }
  return results;
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OAuth Ankorstore HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Pas d'access_token dans la réponse OAuth");
  return json.access_token;
}

async function apiGet(token: string, endpoint: string): Promise<{ status: number; body: unknown; raw: string }> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.api+json",
      "User-Agent": "BeliJolie-Probe/1.0",
    },
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { _parse_error: true, snippet: raw.slice(0, 500) };
  }
  return { status: res.status, body, raw };
}

function summarizeList(body: unknown): string {
  if (!body || typeof body !== "object") return "  (réponse vide ou invalide)";
  const b = body as Record<string, unknown>;
  const data = Array.isArray(b.data) ? b.data : [];
  const meta = (b.meta as Record<string, unknown> | undefined) ?? {};
  const links = (b.links as Record<string, unknown> | undefined) ?? {};
  const included = Array.isArray(b.included) ? b.included : [];

  const lines: string[] = [];
  lines.push(`  data.length          : ${data.length}`);
  lines.push(`  meta                 : ${JSON.stringify(meta).slice(0, 200)}`);
  lines.push(`  links (clés)         : ${Object.keys(links).join(", ") || "—"}`);
  lines.push(`  included.length      : ${included.length}`);
  if (data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const attrs = (first.attributes as Record<string, unknown> | undefined) ?? {};
    const rels = (first.relationships as Record<string, unknown> | undefined) ?? {};
    lines.push(`  data[0].type         : ${first.type}`);
    lines.push(`  data[0].id           : ${first.id}`);
    lines.push(`  data[0].attributes   :`);
    for (const [k, v] of Object.entries(attrs)) {
      const preview =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null
          ? String(v).slice(0, 60)
          : `<${Array.isArray(v) ? `array[${v.length}]` : typeof v}>`;
      lines.push(`    - ${k.padEnd(28)} : ${preview}`);
    }
    lines.push(`  data[0].relationships:`);
    for (const k of Object.keys(rels)) lines.push(`    - ${k}`);
  }
  return lines.join("\n");
}

function summarizeDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "  (réponse vide ou invalide)";
  const b = body as Record<string, unknown>;
  const data = b.data as Record<string, unknown> | undefined;
  const included = Array.isArray(b.included) ? b.included : [];
  if (!data) return "  (pas de champ data)";
  const attrs = (data.attributes as Record<string, unknown> | undefined) ?? {};
  const rels = (data.relationships as Record<string, unknown> | undefined) ?? {};

  const lines: string[] = [];
  lines.push(`  data.type             : ${data.type}`);
  lines.push(`  data.id               : ${data.id}`);
  lines.push(`  data.attributes       : (${Object.keys(attrs).length} champs)`);
  for (const [k, v] of Object.entries(attrs)) {
    const preview =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null
        ? String(v).slice(0, 80)
        : `<${Array.isArray(v) ? `array[${v.length}]` : typeof v}>`;
    lines.push(`    - ${k.padEnd(30)} : ${preview}`);
  }
  lines.push(`  data.relationships    : (${Object.keys(rels).length} champs)`);
  for (const k of Object.keys(rels)) lines.push(`    - ${k}`);
  lines.push(`  included.length       : ${included.length}`);
  const bytypes = new Map<string, number>();
  for (const it of included) {
    const t = (it as { type?: string }).type ?? "?";
    bytypes.set(t, (bytypes.get(t) ?? 0) + 1);
  }
  lines.push(`  included par type     :`);
  for (const [t, n] of bytypes) lines.push(`    - ${t.padEnd(28)} : ${n}`);
  return lines.join("\n");
}

async function probeTenant(t: TenantCreds): Promise<void> {
  console.log(`\n═════ Tenant : ${t.name} (slug=${t.slug}) ═════`);
  const token = await getToken(t.clientId, t.clientSecret);
  console.log("  ✓ Token OAuth obtenu");

  // 1) LISTE
  const listEndpoint = "/orders?page[limit]=5";
  console.log(`\n→ GET ${listEndpoint}`);
  const list = await apiGet(token, listEndpoint);
  console.log(`  HTTP ${list.status}`);
  await fs.writeFile(path.join(OUT_DIR, `${t.slug}-list.json`), list.raw);
  console.log(`  → sauvegardé : scripts/.ankorstore-orders-probe/${t.slug}-list.json`);
  if (list.status !== 200) {
    console.log(`  ⚠ Erreur — corps brut : ${list.raw.slice(0, 500)}`);
    return;
  }
  console.log(summarizeList(list.body));

  // 2) DÉTAIL (première commande, si dispo)
  const data = (list.body as { data?: unknown[] }).data;
  const first = Array.isArray(data) && data.length > 0 ? (data[0] as { id?: string }) : null;
  if (!first?.id) {
    console.log("\n  Pas de commande → skip détail.");
    return;
  }
  const detailEndpoint = `/orders/${first.id}?include=retailer,billingItems,orderItems.productVariant.product`;
  console.log(`\n→ GET /orders/${first.id} (+includes)`);
  const detail = await apiGet(token, detailEndpoint);
  console.log(`  HTTP ${detail.status}`);
  await fs.writeFile(path.join(OUT_DIR, `${t.slug}-detail.json`), detail.raw);
  console.log(`  → sauvegardé : scripts/.ankorstore-orders-probe/${t.slug}-detail.json`);
  if (detail.status !== 200) {
    console.log(`  ⚠ Erreur — corps brut : ${detail.raw.slice(0, 500)}`);
    return;
  }
  console.log(summarizeDetail(detail.body));

  // 3) LISTE avec include pour voir la structure complète
  console.log(`\n→ GET /orders?page[limit]=3&include=retailer,orderItems`);
  const listSimple = await apiGet(token, "/orders?page[limit]=3&include=retailer,orderItems");
  console.log(`  HTTP ${listSimple.status}`);
  await fs.writeFile(path.join(OUT_DIR, `${t.slug}-list-simple.json`), listSimple.raw);
}

async function main() {
  const arg = process.argv[2];
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[Ankorstore Orders Probe] Démarrage${arg ? ` — tenant=${arg}` : " — tous les tenants"}`);

  const tenants = await loadTenantsCreds(arg);
  if (tenants.length === 0) {
    console.log("Aucun tenant avec identifiants Ankorstore trouvés.");
    return;
  }
  console.log(`${tenants.length} tenant(s) à sonder.`);

  for (const t of tenants) {
    try {
      await probeTenant(t);
    } catch (err) {
      console.error(`\n[${t.slug}] Échec :`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .catch((err) => {
    console.error("[Ankorstore Orders Probe] Échec global :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
