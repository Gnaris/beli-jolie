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

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 60_000);
