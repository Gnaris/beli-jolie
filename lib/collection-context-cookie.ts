/**
 * Cookie de contexte collection : posé quand une visiteuse arrive sur une
 * fiche produit via un lien marqué `?via=collection:<id>` depuis une page
 * collection publique. Sert à attribuer un ajout au panier à la collection
 * d'origine — `addToCart` lit le cookie et crée un `CollectionCartAddition`.
 *
 * Mêmes garanties que `catalog-context-cookie` : signature HMAC-SHA256 avec
 * `NEXTAUTH_SECRET`, TTL 30 min embarqué dans le payload.
 */

import * as crypto from "crypto";

export const COLLECTION_CONTEXT_COOKIE_NAME = "bj_collection_ctx";

export const COLLECTION_CONTEXT_TTL_MS = 30 * 60 * 1000;

interface CollectionContextPayload {
  collectionId: string;
  exp: number;
}

function getSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET manquant — impossible de signer le contexte collection.");
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

export function signCollectionContext(collectionId: string, now: number = Date.now()): string {
  const payload: CollectionContextPayload = { collectionId, exp: now + COLLECTION_CONTEXT_TTL_MS };
  const encoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", getSecret()).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

export function verifyCollectionContext(
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

  let payload: CollectionContextPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.collectionId !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < now) return null;
  return payload.collectionId;
}
