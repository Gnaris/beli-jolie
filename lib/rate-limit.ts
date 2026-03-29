import { NextResponse } from "next/server";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, maxAttempts: number, windowMs: number): { success: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: maxAttempts - 1 };
  }

  if (entry.count >= maxAttempts) {
    return { success: false, remaining: 0 };
  }

  entry.count++;
  return { success: true, remaining: maxAttempts - entry.count };
}

/**
 * Extrait l'IP du client depuis les headers de la requête.
 */
export function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Vérifie le rate limit et retourne une Response 429 si dépassé, sinon null.
 * Usage : const blocked = checkRateLimit(req, "prefix", 10, 60_000);
 *         if (blocked) return blocked;
 */
export function checkRateLimit(
  request: { headers: Headers },
  prefix: string,
  maxAttempts: number,
  windowMs: number,
): NextResponse | null {
  const ip = getClientIpFromHeaders(request.headers);
  const key = `${prefix}:${ip}`;
  const result = rateLimit(key, maxAttempts, windowMs);

  if (!result.success) {
    return NextResponse.json(
      { error: "Trop de requêtes. Veuillez réessayer dans quelques instants." },
      { status: 429 },
    );
  }

  return null;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 60_000);
