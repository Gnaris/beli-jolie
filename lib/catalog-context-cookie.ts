/**
 * Cookie de contexte catalogue : posé quand un visiteur ouvre la page publique
 * `/catalogue/{token}`. Sert à attribuer un ajout au panier au catalogue
 * d'origine — l'action `addToCart` lit le cookie et crée un
 * `CatalogCartAddition` si le produit ajouté fait partie du catalogue.
 *
 * Le cookie est **signé HMAC-SHA256** avec `NEXTAUTH_SECRET` : impossible pour
 * un client de forger un contexte pour un catalogue arbitraire. Il embarque
 * une date d'expiration (30 min) au-delà de laquelle il est ignoré même si la
 * signature est valide.
 */

import * as crypto from "crypto";

export const CATALOG_CONTEXT_COOKIE_NAME = "bj_catalog_ctx";

// Fenêtre pendant laquelle un ajout au panier est attribué au catalogue.
// 30 minutes : suffit pour un scroll + réflexion + login, sans polluer les
// visites ultérieures depuis la barre d'adresse.
export const CATALOG_CONTEXT_TTL_MS = 30 * 60 * 1000;

interface CatalogContextPayload {
  catalogId: string;
  exp: number; // epoch ms
}

function getSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET manquant — impossible de signer le contexte catalogue.");
  }
  return Buffer.from(secret, "utf8");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(normalized, "base64");
}

/** Sérialise + signe un payload de contexte. */
export function signCatalogContext(catalogId: string, now: number = Date.now()): string {
  const payload: CatalogContextPayload = { catalogId, exp: now + CATALOG_CONTEXT_TTL_MS };
  const encoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", getSecret()).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

/**
 * Vérifie la signature et l'expiration. Retourne le catalogId si le cookie
 * est valide, sinon null. Toute anomalie (format, signature, expiration)
 * ⇒ null silencieusement — on ne trace rien côté visiteur.
 */
export function verifyCatalogContext(
  cookieValue: string | undefined | null,
  now: number = Date.now(),
): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;

  const encoded = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);

  let expectedSig: Buffer;
  try {
    expectedSig = crypto.createHmac("sha256", getSecret()).update(encoded).digest();
  } catch {
    return null;
  }

  const providedSigBuf = base64UrlDecode(providedSig);
  if (providedSigBuf.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedSigBuf, expectedSig)) return null;

  let payload: CatalogContextPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.catalogId !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < now) return null;
  return payload.catalogId;
}
