/**
 * Token signé (HMAC-SHA256) pour le lien de désinscription newsletter.
 *
 * Le lien inséré dans un mail marketing contient un token qui encode :
 *   - `uid` : userId à désinscrire
 *   - `tid` : tenantId (protection contre le cross-tenant abuse)
 *   - `exp` : timestamp d'expiration (par défaut 90 j)
 *
 * Signé avec `NEXTAUTH_SECRET`. Un clic sur le lien → `/api/newsletter/unsubscribe?t=…`
 * qui vérifie, désinscrit, affiche une page de confirmation.
 *
 * Choix HMAC (pas JWT) : payload court, format URL-safe base64, pas de dep.
 */

import crypto from "crypto";

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours

interface UnsubscribePayload {
  uid: string;
  tid: string;
  exp: number; // ms epoch
}

/** Encode base64url (RFC 4648) : URL-safe, sans padding. */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET manquant — impossible de signer les tokens de désinscription.");
  }
  return secret;
}

function sign(payloadEncoded: string): string {
  return base64UrlEncode(
    crypto.createHmac("sha256", getSecret()).update(payloadEncoded).digest(),
  );
}

/**
 * Crée un token de désinscription pour un utilisateur donné.
 * Format : `<payloadBase64Url>.<hmacBase64Url>`.
 */
export function signUnsubscribeToken(params: {
  userId: string;
  tenantId: string;
  ttlMs?: number;
}): string {
  const payload: UnsubscribePayload = {
    uid: params.userId,
    tid: params.tenantId,
    exp: Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS),
  };
  const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export type VerifyResult =
  | { valid: true; userId: string; tenantId: string }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Vérifie un token de désinscription.
 * - malformed : format inattendu ou payload non-JSON
 * - bad_signature : le HMAC ne correspond pas (token forgé ou tampered)
 * - expired : timestamp d'expiration dépassé
 */
export function verifyUnsubscribeToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [payloadEncoded, signature] = parts;

  const expected = sign(payloadEncoded);
  // Comparaison en temps constant pour éviter les attaques timing.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: UnsubscribePayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded).toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (!payload.uid || !payload.tid || typeof payload.exp !== "number") {
    return { valid: false, reason: "malformed" };
  }
  if (payload.exp < Date.now()) return { valid: false, reason: "expired" };

  return { valid: true, userId: payload.uid, tenantId: payload.tid };
}

/**
 * Construit l'URL absolue de désinscription pour un destinataire donné.
 * `baseUrl` doit être l'URL de la boutique (ex. `https://beliandjolie.com`).
 */
export function buildUnsubscribeUrl(params: {
  baseUrl: string;
  userId: string;
  tenantId: string;
  ttlMs?: number;
}): string {
  const token = signUnsubscribeToken({
    userId: params.userId,
    tenantId: params.tenantId,
    ttlMs: params.ttlMs,
  });
  const base = params.baseUrl.replace(/\/+$/, "");
  return `${base}/api/newsletter/unsubscribe?t=${encodeURIComponent(token)}`;
}
