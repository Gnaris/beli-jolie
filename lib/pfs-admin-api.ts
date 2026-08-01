/**
 * PFS Admin API — API "mobile" de PFS (admin.parisfashionshops.com).
 *
 * Fallback utilisé par pfs-import et pfs-verify quand l'API wholesaler
 * (wholesaler-api.parisfashionshops.com) renvoie une composition vide alors
 * que le vendeur l'a bien saisie via l'appli mobile PFS.
 *
 * Bug racine côté PFS : la synchro wholesaler ↔ admin est incomplète sur
 * le champ composition. L'API admin (que l'appli mobile "PFS - Back Office
 * Grossiste" utilise) a la vérité. On la lit en fallback avec les mêmes
 * identifiants email/password que pour l'API wholesaler.
 */

import { getCachedPfsCredentials } from "@/lib/cached-data";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { logger } from "@/lib/logger";

const PFS_ADMIN_ORIGIN = "https://admin.parisfashionshops.com";
const PFS_ADMIN_API_V1 = `${PFS_ADMIN_ORIGIN}/api/v1`;
const PFS_ADMIN_AUTH_URL = `${PFS_ADMIN_ORIGIN}/api/auth/seller`;

// Identifiant d'app cliente exigé dans le body de toutes les POST admin
// (repéré via HTTP Toolkit sur l'appli mobile PFS).
const AEMIK_SEA_UID = "AemikWeb3_PFSBKOFFICE";

interface AdminTokenCache {
  bearer: string;
  fetchedAt: number;
}
// Cache par tenant : critique multi-tenant (cf pfs-auth.ts).
const tokenCacheByTenant = new Map<string, AdminTokenCache>();
// Cookie PHPSESSID renvoyé par PFS a une TTL de 7 j. On rafraîchit toutes
// les 6 h pour rester large.
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

interface AdminCompositionDictCache {
  entries: PfsAdminCompositionDictEntry[];
  fetchedAt: number;
}
// Cache dictionnaire compositions par tenant × catégorie (les matières
// disponibles varient selon la catégorie PFS).
const compositionDictCacheByTenantCategory = new Map<string, AdminCompositionDictCache>();
const COMPOSITION_DICT_TTL_MS = 60 * 60 * 1000; // 1 h

async function resolveCurrentTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête HTTP → jobs/cron/tests
    }
  }
  return tid ?? "global";
}

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * Entrée du dictionnaire compositions retourné par
 * POST /api/v1/attributes/composition.
 */
export interface PfsAdminCompositionDictEntry {
  Id: number;
  Uid: string;                 // Salesforce Uid, identique à l'`id` wholesaler
  Name: string;                // "Stainless steel"
  Code: string;                // "ACIERINOXYDABLE" — clé utilisée dans Composition_1__c
  Categories: string[];        // ["JEWELRY"]
  LabelFR?: string;
  LabelEN?: string;
  LabelDE?: string;
  LabelES?: string;
  LabelIT?: string;
}

/**
 * Sous-ensemble du produit brut retourné par
 * POST /api/v1/product/get/{pfsProductId} — on ne mappe que les champs
 * dont on a besoin.
 */
interface PfsAdminProductRaw {
  Id: string;
  CategoryId__c?: string | null;
  Composition_1__c?: string | null;
  Composition_2__c?: string | null;
  Composition_3__c?: string | null;
  Composition_4__c?: string | null;
  Composition_5__c?: string | null;
  Composition_1_Percentage__c?: string | null;
  Composition_2_Percentage__c?: string | null;
  Composition_3_Percentage__c?: string | null;
  Composition_4_Percentage__c?: string | null;
  Composition_5_Percentage__c?: string | null;
}

/**
 * Format normalisé compatible avec `checkRef.material_composition` du
 * wholesaler (utilisé par pfs-import.ts et pfs-verify.ts). Permet un
 * drop-in remplacement quand le wholesaler renvoie un array vide.
 */
export interface PfsAdminMaterialEntry {
  id: string;                  // Salesforce Uid
  reference: string;           // "ACIERINOXYDABLE"
  percentage: number;
  /**
   * Labels par locale ("fr" | "en" | "de" | "es" | "it"). Compatible avec
   * `PfsCheckReferenceResponse.product.material_composition[].labels`
   * (Record<string, string>) — on omet les locales absentes plutôt que
   * de renvoyer `undefined`.
   */
  labels: Record<string, string>;
}

// ─── Auth ──────────────────────────────────────────────────────────────

async function getPfsAdminToken(): Promise<string> {
  const tid = await resolveCurrentTenantId();
  const cached = tokenCacheByTenant.get(tid);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS) {
    return cached.bearer;
  }
  const creds = await getCachedPfsCredentials();
  if (!creds.email || !creds.password) {
    throw new Error("Identifiants PFS manquants — configurer dans Paramètres > Marketplaces");
  }
  const res = await fetch(PFS_ADMIN_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: creds.email,
      password: creds.password,
      AemikSEAUID: AEMIK_SEA_UID,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PFS Admin auth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    Response?: { Status?: string; Message?: { Token?: string } };
  };
  const token = data?.Response?.Message?.Token;
  if (!token || data.Response?.Status !== "SUCCEEDED") {
    throw new Error(`PFS Admin auth response invalide : Token manquant`);
  }
  tokenCacheByTenant.set(tid, { bearer: token, fetchedAt: Date.now() });
  return token;
}

export async function invalidatePfsAdminToken(): Promise<void> {
  const tid = await resolveCurrentTenantId();
  tokenCacheByTenant.delete(tid);
}

// ─── HTTP helper ───────────────────────────────────────────────────────

async function pfsAdminPost<T>(
  path: string,
  extraBody: Record<string, unknown> = {},
  { retryOn401 = true }: { retryOn401?: boolean } = {},
): Promise<T> {
  const token = await getPfsAdminToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${PFS_ADMIN_API_V1}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ AemikSEAUID: AEMIK_SEA_UID, ...extraBody }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && retryOn401) {
    await invalidatePfsAdminToken();
    return pfsAdminPost<T>(path, extraBody, { retryOn401: false });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PFS Admin ${res.status}: POST ${path} — ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ─── Endpoints ────────────────────────────────────────────────────────

/**
 * POST /api/v1/attributes/composition — dictionnaire des matières
 * disponibles pour une catégorie (JEWELRY, CLOTH…). Ce dictionnaire est
 * identique à celui exposé par le wholesaler (mêmes `Uid` Salesforce,
 * mêmes `Code`), mais l'API admin le renvoie catégorie par catégorie.
 * Cache 1h par tenant × catégorie.
 */
export async function pfsAdminGetCompositions(
  categoryUid: string,
): Promise<PfsAdminCompositionDictEntry[]> {
  const tid = await resolveCurrentTenantId();
  const cacheKey = `${tid}::${categoryUid}`;
  const cached = compositionDictCacheByTenantCategory.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < COMPOSITION_DICT_TTL_MS) {
    return cached.entries;
  }
  const data = await pfsAdminPost<{
    Response?: { Status?: string; Message?: PfsAdminCompositionDictEntry[] };
  }>("/attributes/composition", { Category: categoryUid });
  const entries = data?.Response?.Message ?? [];
  compositionDictCacheByTenantCategory.set(cacheKey, { entries, fetchedAt: Date.now() });
  return entries;
}

/**
 * POST /api/v1/product/get/{pfsProductId} — produit brut Salesforce.
 * Contient les 5 slots `Composition_{n}__c` + pourcentages, même quand
 * l'API wholesaler renvoie composition vide.
 */
export async function pfsAdminGetProduct(
  pfsProductId: string,
): Promise<PfsAdminProductRaw | null> {
  const data = await pfsAdminPost<{
    Response?: { Status?: string; Message?: PfsAdminProductRaw };
  }>(`/product/get/${encodeURIComponent(pfsProductId)}`);
  const msg = data?.Response?.Message;
  if (!msg || typeof msg !== "object") return null;
  return msg;
}

// ─── Helper haut niveau ────────────────────────────────────────────────

/**
 * Récupère la composition d'un produit PFS via l'API admin (mobile).
 * Retourne un array au format compatible avec
 * `checkRef.material_composition` du wholesaler — permet un remplacement
 * en place quand le wholesaler renvoie vide.
 *
 * @param pfsProductId identifiant PFS interne (ex : `pro_306373f22f72a...`)
 * @returns array normalisé (vide si aucune compo côté admin non plus)
 */
export async function pfsAdminFetchMaterialComposition(
  pfsProductId: string,
): Promise<PfsAdminMaterialEntry[]> {
  const raw = await pfsAdminGetProduct(pfsProductId);
  if (!raw) return [];

  const slots: Array<{ code: string | null | undefined; pct: string | null | undefined }> = [
    { code: raw.Composition_1__c, pct: raw.Composition_1_Percentage__c },
    { code: raw.Composition_2__c, pct: raw.Composition_2_Percentage__c },
    { code: raw.Composition_3__c, pct: raw.Composition_3_Percentage__c },
    { code: raw.Composition_4__c, pct: raw.Composition_4_Percentage__c },
    { code: raw.Composition_5__c, pct: raw.Composition_5_Percentage__c },
  ];
  const filled = slots.filter((s): s is { code: string; pct: string | null | undefined } =>
    typeof s.code === "string" && s.code.trim().length > 0,
  );
  if (filled.length === 0) return [];

  // Enrichissement labels via le dictionnaire (best-effort : si échec,
  // on renvoie tout de même les codes bruts avec fallback label = code).
  let dict: PfsAdminCompositionDictEntry[] = [];
  if (raw.CategoryId__c) {
    try {
      dict = await pfsAdminGetCompositions(raw.CategoryId__c);
    } catch (err) {
      logger.warn("[PFS Admin] Dictionnaire compositions indisponible", {
        pfsProductId,
        category: raw.CategoryId__c,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const byCode = new Map(dict.map((d) => [d.Code, d]));

  return filled.map((slot) => {
    const percentage = slot.pct ? Number(slot.pct) : 100;
    const entry = byCode.get(slot.code);
    const labels: Record<string, string> = {};
    if (entry?.LabelFR) labels.fr = entry.LabelFR;
    if (entry?.LabelEN) labels.en = entry.LabelEN;
    if (entry?.LabelDE) labels.de = entry.LabelDE;
    if (entry?.LabelES) labels.es = entry.LabelES;
    if (entry?.LabelIT) labels.it = entry.LabelIT;
    return {
      id: entry?.Uid ?? slot.code,
      reference: slot.code,
      percentage: Number.isFinite(percentage) ? percentage : 100,
      labels,
    };
  });
}

// ─── Helpers exposés pour tests ────────────────────────────────────────

/** @internal — vide les caches token + dictionnaire (utile en tests). */
export function _resetPfsAdminCachesForTests(): void {
  tokenCacheByTenant.clear();
  compositionDictCacheByTenantCategory.clear();
}
