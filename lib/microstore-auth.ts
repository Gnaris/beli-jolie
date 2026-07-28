/**
 * Microstore (Dokkr) Authentication — QR code flow
 *
 * Microstore n'a pas d'API publique. La console web `web.mc.app` se logue via
 * QR code (comme WhatsApp Web) : la page génère un `code` client-side
 * (`<pid>&<random>&<timestamp>&<md5>`) et le poll toutes les secondes.
 * Une fois qu'un téléphone connecté a scanné le QR, l'endpoint renvoie une
 * clé de session (`5_XXX`) + un JWT (`mask_token`) valide ~1 an.
 *
 * Cette lib :
 * 1. Génère le code + QR image côté serveur (algo décodé du bundle JS Microstore)
 * 2. Poll côté serveur pour récupérer la clé
 * 3. Chiffre + persiste la clé dans SiteConfig (`microstore_session_key`)
 * 4. Fournit un cache par tenant pour éviter les fuites cross-tenant
 */

import * as crypto from "crypto";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { getCachedMicrostoreSessionKey } from "@/lib/cached-data";

export const MC_API_BASE = "https://api2.dokkr.net/index.php";
export const MC_PID = "5-MC";
// Secret publiquement observable dans le bundle web.mc.app (main.*.js).
// Utilisé uniquement pour signer le code de scan QR côté client — pas un vrai
// secret côté Microstore, c'est juste un marqueur d'app.
export const MC_SECRET = "TIYZ5GuvK2CEzfTHvK4Uw2TGxrkR5UT1";
export const MC_QR_ORIGIN = "https://mc2-h5.dokkr.net";

// CRITIQUE multi-tenant : clé de session PAR tenant. Sans ça, une clé Issyma
// serait réutilisée pour BJ (cf. incident faire-auth 15/07/2026).
const primedSessionKeyByTenant = new Map<string, string>();

async function resolveCurrentTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête
    }
  }
  return tid ?? "global";
}

/**
 * Amorce une clé de session pour un tenant spécifique (usage CLI).
 */
export function primeMicrostoreSessionKey(tenantId: string, key: string): void {
  const trimmed = key.trim();
  if (trimmed) primedSessionKeyByTenant.set(tenantId, trimmed);
  else primedSessionKeyByTenant.delete(tenantId);
}

/**
 * Retourne la clé de session déchiffrée du tenant courant, ou null si non
 * configurée.
 *
 * Ordre de résolution :
 *  1. Cache primed en mémoire (usage CLI via `primeMicrostoreSessionKey`).
 *  2. Cache `unstable_cache` (5 min).
 *  3. **Fallback lecture directe** BDD si le cache renvoie null — évite
 *     le faux « session expirée » quand la connexion QR vient d'être faite
 *     mais que le cache n'a pas encore été invalidé sur ce chemin de code
 *     (ex : navigation client sur `/admin/produits` qui a rempli le cache
 *     avec `null` avant la reconnexion).
 */
export async function getMicrostoreSessionKey(): Promise<string | null> {
  const tid = await resolveCurrentTenantId();
  const primed = primedSessionKeyByTenant.get(tid);
  if (primed) return primed;

  const cached = await getCachedMicrostoreSessionKey();
  if (cached) return cached;

  // Fallback direct BDD — évite d'être bloqué par un cache périmé.
  try {
    const { prisma } = await import("@/lib/prisma");
    const { decryptIfSensitive } = await import("@/lib/encryption");
    const row = await prisma.siteConfig.findFirst({
      where:
        !tid || tid === "global"
          ? { key: "microstore_session_key" }
          : { tenantId: tid, key: "microstore_session_key" },
      select: { value: true },
    });
    if (!row?.value) return null;
    return decryptIfSensitive("microstore_session_key", row.value)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Génère un `code` de scan QR au format `5-MC&<random12>&<timestamp>&<md5>`.
 * Reproduit l'algorithme du bundle web.mc.app (`fetchAirQrCode`).
 */
export function generateMicrostoreScanCode(nowSec?: number): {
  code: string;
  random: string;
  timestamp: number;
  qrPayload: string;
} {
  const alphabet =
    "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz0123456789";
  let random = "";
  for (let i = 0; i < 12; i++) {
    random += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  const timestamp = nowSec ?? Math.floor(Date.now() / 1000);
  const toHash = `${MC_PID}&${random}&${timestamp}&${MC_SECRET}`;
  const hash = crypto.createHash("md5").update(toHash).digest("hex");
  const code = `${MC_PID}&${random}&${timestamp}&${hash}`;
  // Contenu réel encodé dans le QR (URL que scanne l'app mobile Microstore).
  const qrPayload = `${MC_QR_ORIGIN}/auth.html#/?type=5&secretCode=${encodeURIComponent(code)}`;
  return { code, random, timestamp, qrPayload };
}

export interface MicrostorePollWaiting {
  status: "waiting";
}
export interface MicrostorePollSuccess {
  status: "success";
  token: string;
  maskToken: string;
}
export interface MicrostorePollError {
  status: "error";
  error: string;
}
export type MicrostorePollResult =
  | MicrostorePollWaiting
  | MicrostorePollSuccess
  | MicrostorePollError;

/**
 * Interroge le serveur Microstore pour savoir si le QR a été scanné.
 * - err 6061 = pas encore scanné (waiting)
 * - err 6244 = code expiré → il faut regénérer un nouveau code
 * - err 6245 = timeout
 * - err 0 + token = succès
 */
export async function pollMicrostoreScan(code: string): Promise<MicrostorePollResult> {
  const url = new URL(`${MC_API_BASE}/user/get_web_token`);
  url.searchParams.set("code", code);
  url.searchParams.set("version", "1.64.16");
  url.searchParams.set("pid", "5");
  url.searchParams.set("lang", "fr");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      cache: "no-store",
    });
  } catch {
    return { status: "error", error: "Impossible de contacter Microstore." };
  }

  if (!res.ok) {
    return { status: "error", error: `Microstore a répondu HTTP ${res.status}.` };
  }

  const data = (await res.json().catch(() => null)) as {
    err?: number;
    token?: string;
    mask_token?: string;
    msg?: string;
  } | null;
  if (!data) {
    return { status: "error", error: "Réponse Microstore invalide." };
  }

  if (data.err === 0 && data.token) {
    return {
      status: "success",
      token: data.token,
      maskToken: data.mask_token ?? "",
    };
  }
  if (data.err === 6061) return { status: "waiting" };
  if (data.err === 6244) return { status: "error", error: "expired" };
  if (data.err === 6245) return { status: "error", error: "timeout" };
  return { status: "error", error: data.msg || `Erreur Microstore (${data.err})` };
}

/**
 * Détecte si une réponse Microstore signale une session expirée
 * (à traiter par un bandeau "Reconnecter Microstore" côté UI).
 */
export function isMicrostoreSessionExpiredError(err: number | undefined): boolean {
  // 6011 = session expirée, 6061 = pas de session, 6001 = auth manquante
  return err === 6011 || err === 6061 || err === 6001;
}

/**
 * Décode le champ `exp` (Unix seconds) d'un JWT Microstore `mask_token` sans
 * vérifier la signature (on n'a pas la clé publique, mais on l'utilise juste
 * pour afficher la date d'expiration à l'admin).
 * Retourne null si le décodage échoue.
 */
export function decodeMicrostoreTokenExpiration(maskToken: string): number | null {
  if (!maskToken) return null;
  // Le mask_token du HAR commence par un "1" avant l'entête JWT standard.
  // On strippe ce préfixe numérique si présent (spécificité Dokkr).
  const stripped = maskToken.replace(/^\d+/, "");
  const parts = stripped.split(".");
  if (parts.length < 2) return null;
  try {
    // base64url → base64 standard
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    const json = Buffer.from(payload + pad, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { exp?: number };
    if (typeof parsed.exp === "number" && parsed.exp > 0) return parsed.exp;
    return null;
  } catch {
    return null;
  }
}

/**
 * Construit une URL API Microstore avec la clé de session en query string.
 * Throw si la clé n'est pas configurée pour le tenant courant.
 */
export async function buildMicrostoreUrl(
  path: string,
  extraParams?: Record<string, string>,
): Promise<string> {
  const key = await getMicrostoreSessionKey();
  if (!key) {
    throw new Error(
      "Microstore non connecté — configurer dans Paramètres > Marketplaces > Microstore",
    );
  }
  const url = new URL(`${MC_API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("key", key);
  url.searchParams.set("pid", "5");
  url.searchParams.set("lang", "fr");
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}
