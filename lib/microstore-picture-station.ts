/**
 * Microstore — Station de transfert d'images (API H5 `v2.microstore.app`).
 *
 * Contexte : Microstore expose deux APIs distinctes :
 *  - `api2.dokkr.net` (BOSS/merchant) — utilisée par `lib/microstore-auth.ts`
 *    pour importer les commandes. Session obtenue par QR code, valide ~1 an.
 *  - `v2.microstore.app` (H5/acheteur) — utilisée par la « Station de
 *    transfert d'images ». Authentification par `pictureStationKey`
 *    généré côté Microstore et valide ~7 jours.
 *
 * Cette lib gère uniquement le second flux : l'admin colle le lien de partage
 * `https://microstore.app/s/wuu9t` généré depuis son back Microstore, on
 * extrait le `key`, on valide contre `/api/pictureStations/expiredTime` et on
 * persiste en SiteConfig.
 *
 * Endpoints (reverse-engineered, HAR fournis par la cliente 2026-07-30) :
 *   GET  /api/pictureStations/expiredTime?pictureStationKey=…  → { expiredTime: <ms> }
 *   GET  /api/pictureStations/company?pictureStationKey=…      → infos boutique
 *   GET  /api/ossToken?pictureStationKey=…                      → creds OSS temp
 *   POST https://dcdn.microstore.app/                           → upload direct OSS
 *   GET  /api/companies/goods/itemRef?itemRef=…                 → fiche produit
 *   PATCH /api/goods/{goodsId}?pictureStationKey=…              → assigne les images
 */

import * as crypto from "crypto";
import { logger } from "@/lib/logger";

export const MICROSTORE_H5_API_BASE = "https://v2.microstore.app";
export const MICROSTORE_SHORT_URL_HOST = "microstore.app";

/**
 * Extrait le `pictureStationKey` depuis :
 *  - une URL courte : `https://microstore.app/s/wuu9t` (suit la 301)
 *  - une URL complète : `https://<tenant>.microstore.app/imageTransferStation#/imageTransferStation?shortUrl=wuu9t&key=NBqdsz`
 *  - un fragment : `?key=NBqdsz&shortUrl=wuu9t`
 *  - le key nu : `NBqdsz`
 *
 * Retourne le key trimmé ou null si irrécupérable.
 */
export async function extractPictureStationKey(input: string): Promise<string | null> {
  const raw = (input || "").trim();
  if (!raw) return null;

  // Cas 1 : chaîne courte sans schéma — probablement le key nu (5-15 chars alphanum)
  if (!raw.includes("/") && !raw.includes("?") && !raw.includes("=")) {
    if (/^[A-Za-z0-9_-]{4,64}$/.test(raw)) return raw;
    return null;
  }

  // Cas 2 : URL courte — Microstore renvoie une 301 dont le header Location
  // contient le fragment `#/…?key=XXX`. Attention : `fetch` avec `redirect:
  // "follow"` strippe le fragment de la Location conformément à la RFC HTTP,
  // et donc `res.url` ne le contient plus. Il faut lire la 301 en manuel.
  if (/^https?:\/\/(www\.)?microstore\.app\/s\//i.test(raw)) {
    try {
      const res = await fetch(raw, { method: "GET", redirect: "manual", cache: "no-store" });
      const location = res.headers.get("location");
      if (location) {
        const key = pickKeyFromUrlLike(location);
        if (key) return key;
      }
    } catch (err) {
      logger.warn("[Microstore/PS] short URL follow failed", { error: err, raw });
    }
  }

  // Cas 3 : URL complète ou fragment — parser directement
  return pickKeyFromUrlLike(raw);
}

/** Parse `?key=X` / `#/…?key=X` / `key=X&…` depuis n'importe quelle chaîne. */
function pickKeyFromUrlLike(s: string): string | null {
  // On teste les 2 endroits classiques : query string et hash
  const hashIdx = s.indexOf("#");
  const hash = hashIdx >= 0 ? s.slice(hashIdx + 1) : "";
  const query = s.split("#")[0];
  for (const candidate of [hash, query, s]) {
    const m = candidate.match(/(?:^|[?&])key=([A-Za-z0-9_-]{4,64})(?:$|&)/);
    if (m) return m[1];
  }
  return null;
}

export interface PictureStationValidation {
  key: string;
  expiresAt: Date;
}

/**
 * Valide un `pictureStationKey` en interrogeant Microstore. Retourne la date
 * d'expiration. Throw en cas d'échec (clé inconnue, expirée, réseau…).
 */
export async function validatePictureStationKey(key: string): Promise<PictureStationValidation> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/pictureStations/expiredTime`);
  url.searchParams.set("pictureStationKey", key);
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      cache: "no-store",
    });
  } catch (err) {
    logger.error("[Microstore/PS] validate: network error", { error: err });
    throw new Error("Impossible de contacter Microstore.");
  }
  if (!res.ok) {
    throw new Error(`Microstore a répondu HTTP ${res.status}.`);
  }
  const data = (await res.json().catch(() => null)) as { expiredTime?: number } | null;
  if (!data || typeof data.expiredTime !== "number") {
    throw new Error("Lien de la station de transfert invalide ou expiré.");
  }
  const expiresAt = new Date(data.expiredTime);
  if (expiresAt.getTime() < Date.now()) {
    throw new Error("Ce lien de station de transfert est déjà expiré.");
  }
  return { key, expiresAt };
}

export interface StoredPictureStation {
  key: string;
  expiresAt: Date;
  shortUrl: string | null;
}

/**
 * Retourne le key persistant (déchiffré) + expiration, ou null si non configuré.
 */
export async function getStoredPictureStation(): Promise<StoredPictureStation | null> {
  const { prisma } = await import("@/lib/prisma");
  const { decryptIfSensitive } = await import("@/lib/encryption");
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: [
          "microstore_picture_station_key",
          "microstore_picture_station_expires_at",
          "microstore_picture_station_short_url",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value] as const));
  const encKey = byKey.get("microstore_picture_station_key");
  const expiresRaw = byKey.get("microstore_picture_station_expires_at");
  if (!encKey || !expiresRaw) return null;
  const key = decryptIfSensitive("microstore_picture_station_key", encKey);
  if (!key) return null;
  const ts = Number(expiresRaw);
  if (!Number.isFinite(ts)) return null;
  return {
    key,
    expiresAt: new Date(ts),
    shortUrl: byKey.get("microstore_picture_station_short_url") || null,
  };
}

// ─── OSS upload (Aliyun) ────────────────────────────────────────────────────

/**
 * Creds STS temporaires renvoyés par `GET /api/ossToken`. Le champ le plus
 * important est `ossUploadUrl` (= `ossHost`) : c'est vers cette URL qu'on POST
 * l'image en multipart/form-data. `ossCdnHost` sert à construire l'URL publique
 * finale du fichier (qui sera transmise au PATCH `/api/goods/{id}`).
 */
export interface MicrostoreOssToken {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  ossRegion: string;
  ossHost: string;
  ossBucket: string;
  ossCdnHost: string;
  ossUploadUrl: string;
}

/**
 * Récupère un token OSS temporaire depuis Microstore. Ces creds sont valides
 * quelques minutes : re-demander avant chaque upload plutôt que de cacher.
 */
export async function getMicrostoreOssToken(
  pictureStationKey: string,
): Promise<MicrostoreOssToken> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/ossToken`);
  url.searchParams.set("pictureStationKey", pictureStationKey);
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Microstore ossToken a répondu HTTP ${res.status}.`);
  }
  const data = (await res.json().catch(() => null)) as MicrostoreOssToken | null;
  if (!data || !data.accessKeyId || !data.ossUploadUrl) {
    throw new Error("Réponse ossToken Microstore invalide.");
  }
  return data;
}

/**
 * Génère un `key` (chemin S3-like) unique pour un fichier uploadé. Convention
 * Microstore observée dans les HARs : `<companyId>/MSH5_<md5>.<EXT>`.
 *
 * Le hash est aléatoire (pas un hash du contenu) — Microstore veut juste un nom
 * de fichier unique dans le bucket. On garde l'extension en majuscule comme
 * dans les HARs (`.JPG`, `.PNG`).
 */
export function buildOssObjectKey(companyId: number | string, originalFilename: string): string {
  const ext = (originalFilename.match(/\.([a-zA-Z0-9]+)$/)?.[1] || "jpg").toUpperCase();
  const rand = crypto.randomBytes(16).toString("hex"); // 32 hex chars comme dans le HAR
  return `${companyId}/MSH5_${rand}.${ext}`;
}

/**
 * Construit une "PostObject Policy" Aliyun OSS : JSON avec expiration et
 * conditions, encodé base64, signé HMAC-SHA1 avec l'`accessKeySecret`.
 *
 * Doc Aliyun : https://help.aliyun.com/document_detail/31988.html
 *
 * Observation HAR : Microstore utilise une policy minimale avec juste une
 * `content-length-range` — pas de conditions sur `key` ou `bucket`. On copie
 * cette convention pour rester fidèle au flux observé.
 */
export function buildOssPostPolicy(
  accessKeySecret: string,
  opts: { expirationSec?: number; maxSizeBytes?: number } = {},
): { policy: string; signature: string } {
  const exp = new Date(Date.now() + (opts.expirationSec ?? 300) * 1000);
  const policyObj = {
    expiration: exp.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    conditions: [["content-length-range", 0, opts.maxSizeBytes ?? 20 * 1024 * 1024]],
  };
  const policy = Buffer.from(JSON.stringify(policyObj)).toString("base64");
  const signature = crypto
    .createHmac("sha1", accessKeySecret)
    .update(policy)
    .digest("base64");
  return { policy, signature };
}

/**
 * Détermine le Content-Type d'une image à partir de son nom de fichier.
 * Utilisé pour poser le bon type MIME dans le multipart — Microstore ne semble
 * pas être regardant, mais on reste propre.
 */
function guessContentType(filename: string): string {
  const ext = filename.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export interface UploadedOssImage {
  /** URL publique de l'image (à passer au PATCH `/api/goods/{id}`). */
  publicUrl: string;
  /** Chemin S3 dans le bucket (utile pour debug ou suppression future). */
  ossKey: string;
  /** Taille en octets du binaire uploadé. */
  size: number;
}

/**
 * Upload un fichier image vers le CDN Aliyun de Microstore.
 *
 * Flow (reverse-engineered depuis les HAR Station de Transfert) :
 *  1. Récupère un token OSS temporaire via `getMicrostoreOssToken()`.
 *  2. Génère un `key` d'objet unique + policy + signature.
 *  3. POST multipart/form-data vers `ossUploadUrl`.
 *  4. Retourne l'URL CDN publique du fichier (que Microstore acceptera dans le
 *     payload du PATCH `/api/goods/{goodsId}`).
 *
 * @param pictureStationKey Clé de station de transfert valide.
 * @param companyId Identifiant boutique (récupéré via
 *                  `/api/pictureStations/company`, généralement 3976 pour BJ).
 * @param buffer   Binaire brut du fichier image.
 * @param filename Nom d'origine (sert à l'extension et au champ `name` visible
 *                 dans le back Microstore, sans effet fonctionnel).
 */
export async function uploadImageToMicrostoreOss(
  pictureStationKey: string,
  companyId: number | string,
  buffer: Buffer,
  filename: string,
): Promise<UploadedOssImage> {
  const token = await getMicrostoreOssToken(pictureStationKey);
  const ossKey = buildOssObjectKey(companyId, filename);
  const { policy, signature } = buildOssPostPolicy(token.accessKeySecret);

  const form = new FormData();
  form.append("name", filename);
  form.append("key", ossKey);
  form.append("policy", policy);
  form.append("OSSAccessKeyId", token.accessKeyId);
  form.append("success_action_status", "200");
  form.append("signature", signature);
  form.append("x-oss-security-token", token.securityToken);
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: guessContentType(filename) }),
    filename,
  );

  const res = await fetch(token.ossUploadUrl, { method: "POST", body: form, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Upload OSS Microstore a échoué (HTTP ${res.status}) : ${text.slice(0, 300)}`,
    );
  }

  const publicUrl = `${token.ossCdnHost.replace(/\/$/, "")}/${ossKey}`;
  return { publicUrl, ossKey, size: buffer.byteLength };
}

// ─── Recherche produit + PATCH images ──────────────────────────────────────

export interface MicrostoreGoodsSku {
  skuId: number;
  colorId: number;
  colorName: string;
  sizeName: string;
}

export interface MicrostoreGoods {
  goodsId: number;
  itemRef: string;
  name: string;
  skus: MicrostoreGoodsSku[];
}

/**
 * Recherche exacte d'un produit Microstore par sa référence externe (== `itemRef`).
 * Utilisé pour retrouver le `goodsId` + les `skuIds` avant de PATCH les images.
 *
 * Renvoie null si la référence n'existe pas côté Microstore.
 */
export async function getMicrostoreGoodsByItemRef(
  pictureStationKey: string,
  itemRef: string,
): Promise<MicrostoreGoods | null> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/companies/goods/itemRef`);
  url.searchParams.set("itemRef", itemRef);
  url.searchParams.set("pictureStationKey", pictureStationKey);
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Microstore goods/itemRef HTTP ${res.status}.`);
  }
  const data = (await res.json().catch(() => null)) as {
    goodsId?: number;
    itemRef?: string;
    name?: string;
    skus?: Array<{
      skuId: number;
      colorId: number;
      colorName: string;
      sizeName?: string;
    }>;
  } | null;
  if (!data || typeof data.goodsId !== "number") return null;
  return {
    goodsId: data.goodsId,
    itemRef: data.itemRef ?? itemRef,
    name: data.name ?? "",
    skus: (data.skus ?? []).map((s) => ({
      skuId: s.skuId,
      colorId: s.colorId,
      colorName: s.colorName ?? "",
      sizeName: s.sizeName ?? "",
    })),
  };
}

/**
 * Payload PATCH `/api/goods/{goodsId}` observé dans le HAR (mode « importation
 * manuelle 1 produit »). `coverImage` = image principale affichée sur la fiche.
 * `imageSetting.skuImage[]` = mapping skuIds → URLs des images CDN Microstore.
 */
export interface MicrostoreImageSettingSkuImage {
  skuIds: number[];
  images: string[];
}

export interface MicrostorePatchImagesPayload {
  coverImage: string;
  mainImages: string[];
  imageSetting: {
    skuImage: MicrostoreImageSettingSkuImage[];
  };
}

/**
 * Payload d'une image transmise au bulk `pictureStations` (mode « importation
 * en masse » du HAR). `goodsImageSetting.itemRef` + `colorName` permettent à
 * Microstore de matcher tout seul avec le bon produit et la bonne couleur.
 */
export interface MicrostoreBulkPictureEntry {
  name: string;
  fileName: string;
  image: string;
  goodsImageSetting: {
    itemRef: string;
    colorName: string;
    order: number;
  };
}

/**
 * Envoie un lot d'images vers Microstore via `POST /api/v3/pictureStations` en
 * mode « importation en masse ». Un seul appel API pour N produits/N couleurs
 * — Microstore fait tout le matching côté serveur en se basant sur `itemRef` +
 * `colorName`.
 *
 * Prérequis : chaque `entry.image` doit déjà être une URL du CDN Microstore
 * (obtenue via `uploadImageToMicrostoreOss`). Cette fonction ne fait que
 * l'appel de finalisation, pas les uploads.
 */
export async function bulkImportMicrostorePictures(
  pictureStationKey: string,
  pictures: MicrostoreBulkPictureEntry[],
): Promise<{ successCount: number; failedCount: number; causes: unknown[] }> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/v3/pictureStations`);
  url.searchParams.set("pictureStationKey", pictureStationKey);
  url.searchParams.set("importToGoods", "true");
  url.searchParams.set("mixSymbol", "mix");
  url.searchParams.set("importMainToColor", "");
  url.searchParams.set("defaultLang", "en");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ pictures }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Microstore bulk pictureStations HTTP ${res.status} : ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json().catch(() => null)) as
    | { successCount?: number; failedCount?: number; causes?: unknown[] }
    | null;
  return {
    successCount: data?.successCount ?? 0,
    failedCount: data?.failedCount ?? 0,
    causes: data?.causes ?? [],
  };
}

/**
 * PATCH les images d'un produit Microstore. `payload.coverImage` remplace la
 * miniature affichée dans la vitrine, `payload.imageSetting.skuImage` remplace
 * les images par SKU (couleur × taille).
 *
 * Attention : le PATCH **remplace** — les images déjà présentes sur Microstore
 * pour un SKU non listé ici restent en place, mais un SKU listé se voit
 * assigner exactement la liste fournie.
 */
export async function patchMicrostoreGoodsImages(
  pictureStationKey: string,
  goodsId: number,
  payload: MicrostorePatchImagesPayload,
): Promise<void> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/goods/${goodsId}`);
  url.searchParams.set("pictureStationKey", pictureStationKey);
  url.searchParams.set("defaultLang", "en");
  url.searchParams.set("lang", "fr");
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Microstore PATCH /goods/${goodsId} HTTP ${res.status} : ${text.slice(0, 300)}`,
    );
  }
}

// ─── Company info (utile pour construire les OSS keys) ─────────────────────

export interface MicrostoreCompanyInfo {
  companyId: number;
  companyName: string;
  currency?: string;
}

/**
 * Retourne le `companyId` Microstore de la boutique référencée par le
 * `pictureStationKey`. Nécessaire pour construire le path OSS (`<companyId>/MSH5_…`).
 */
export async function getMicrostorePictureStationCompany(
  pictureStationKey: string,
): Promise<MicrostoreCompanyInfo> {
  const url = new URL(`${MICROSTORE_H5_API_BASE}/api/pictureStations/company`);
  url.searchParams.set("pictureStationKey", pictureStationKey);
  url.searchParams.set("terminal", "h5");
  url.searchParams.set("bigScreen", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Microstore pictureStations/company HTTP ${res.status}.`);
  }
  const data = (await res.json().catch(() => null)) as MicrostoreCompanyInfo | null;
  if (!data || typeof data.companyId !== "number") {
    throw new Error("Réponse pictureStations/company invalide.");
  }
  return data;
}
