/**
 * lib/carrier-signature.ts
 *
 * Signature HMAC-SHA256 des transporteurs Easy-Express renvoyés par
 * `/api/carriers`. Empêche un client malicieux d'envoyer `carrierPrice=0` à
 * `/api/payments/create-intent` pour payer 0 € de port (audit checkout §8).
 *
 * Le trio signé `(carrierId, priceCents, transactionId)` est renvoyé par
 * `/api/carriers` et le client doit le repasser tel quel à `create-intent`.
 * Le transactionId Easy-Express expire vite → la signature est time-bounded
 * naturellement.
 *
 * Utilise `ENCRYPTION_KEY` comme secret HMAC (déjà 32 bytes base64, existante,
 * scopée par install, jamais exposée côté client).
 */

import "server-only";
import * as crypto from "crypto";

const SPECIAL_CARRIER_IDS = new Set(["pickup_store", "private_carrier"]);

function hmacSecret(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY manquante — signature transporteur impossible.");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY doit être exactement 32 bytes (base64).");
  }
  return buf;
}

export function signCarrier(input: {
  carrierId: string;
  priceCents: number;
  transactionId: string;
}): string {
  const payload = `${input.carrierId}|${input.priceCents}|${input.transactionId}`;
  return crypto.createHmac("sha256", hmacSecret()).update(payload).digest("hex");
}

/**
 * Vérifie qu'un tuple (carrierId, carrierPrice, transactionId, sig) provient
 * bien de notre backend. Retourne `true` si signature valide.
 *
 * - `pickup_store` / `private_carrier` : pas de signature, on impose price=0
 *   côté serveur (à valider par l'appelant AVANT ce helper).
 * - `fallback_*` (obsolète) : refusé (pas de mécanisme de signature côté API).
 * - Tout autre id : signature obligatoire, tolérance 1 centime pour absorber
 *   les arrondis IEEE-754 entre client et serveur.
 */
export function verifyCarrierSignature(input: {
  carrierId: string;
  carrierPrice: number;
  transactionId: string;
  carrierSig: string;
}): boolean {
  if (SPECIAL_CARRIER_IDS.has(input.carrierId)) {
    return input.carrierPrice === 0;
  }
  if (input.carrierId.startsWith("fallback_")) {
    return false;
  }
  if (!input.transactionId || !input.carrierSig) return false;

  const expectedCents = Math.round(input.carrierPrice * 100);
  // On tolère ±1 centime pour absorber les arrondis JS (le prix HMAC-signé est
  // toujours l'entier en centimes tel qu'il sort de /api/carriers).
  for (const priceCents of [expectedCents - 1, expectedCents, expectedCents + 1]) {
    if (priceCents < 0) continue;
    const expected = signCarrier({
      carrierId: input.carrierId,
      priceCents,
      transactionId: input.transactionId,
    });
    if (timingSafeEqualHex(expected, input.carrierSig)) return true;
  }
  return false;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const CARRIER_SIGNATURE_SPECIAL_IDS = SPECIAL_CARRIER_IDS;
