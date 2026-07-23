/**
 * lib/email-marketing/tokens.ts
 *
 * Tokens signés HMAC-SHA256 pour :
 *   - Liens de désinscription (payload : tenantId + email + scope)
 *   - Liens de suivi (payload : sendId)
 *
 * Utilise NEXTAUTH_SECRET pour signer. Fail-close si le secret est absent.
 */
import crypto from "crypto";

type UnsubscribePayload = {
  t: string; // tenantId
  e: string; // email (normalisé lowercase)
  s: string; // scope
};

type TrackingPayload = {
  id: string; // EmailSend.id
};

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("NEXTAUTH_SECRET manquant — impossible de signer les tokens email");
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", getSecret()).update(payload).digest();
  return b64url(mac);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─────────────────────────────────────────────────────────────
// Désinscription
// ─────────────────────────────────────────────────────────────

export function encodeUnsubscribeToken(
  tenantId: string,
  email: string,
  scope: string,
): string {
  const payload: UnsubscribePayload = {
    t: tenantId,
    e: email.toLowerCase().trim(),
    s: scope,
  };
  const raw = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = sign(raw);
  return `${raw}.${sig}`;
}

export function decodeUnsubscribeToken(token: string): UnsubscribePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [raw, sig] = parts;
  try {
    if (!safeEqual(sign(raw), sig)) return null;
    const payload = JSON.parse(b64urlDecode(raw).toString("utf8")) as UnsubscribePayload;
    if (!payload.t || !payload.e || !payload.s) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Tracking (pixel d'ouverture)
// ─────────────────────────────────────────────────────────────

export function encodeTrackingToken(sendId: string): string {
  const payload: TrackingPayload = { id: sendId };
  const raw = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = sign(raw);
  return `${raw}.${sig}`;
}

export function decodeTrackingToken(token: string): TrackingPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [raw, sig] = parts;
  try {
    if (!safeEqual(sign(raw), sig)) return null;
    const payload = JSON.parse(b64urlDecode(raw).toString("utf8")) as TrackingPayload;
    if (!payload.id) return null;
    return payload;
  } catch {
    return null;
  }
}
