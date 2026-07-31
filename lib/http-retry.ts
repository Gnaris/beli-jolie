/**
 * Helper commun de retry HTTP pour les 4 marketplaces (PFS, Ankorstore, eFashion, Faire).
 *
 * Motivation : le pattern « 3 tentatives, backoff exponentiel, retry si 429/5xx »
 * est aujourd'hui recopié dans lib/faire-api.ts, lib/ankorstore-api.ts,
 * lib/pfs-api-write.ts. Ce module offre un point unique — à adopter
 * progressivement, sans forcer le refactor.
 *
 * ⚠️ Ne pas confondre avec le `withRetry` local de lib/pfs-import-processor.ts
 * qui, lui, cible les erreurs Prisma (P1017/P2024).
 */

export interface RetryOptions {
  /** Nombre max de tentatives (défaut 3). */
  maxAttempts?: number;
  /** Délai de base en ms pour le backoff exponentiel (défaut 500). */
  baseDelayMs?: number;
  /** Plafond du délai en ms (défaut 8000). */
  maxDelayMs?: number;
  /** Callback informatif (logging optionnel). */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

/** Retry générique sur toute erreur, backoff exponentiel + jitter. */
export async function withHttpRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = Math.floor(Math.random() * (baseDelayMs / 2));
      const wait = delay + jitter;
      opts.onRetry?.({ attempt, delayMs: wait, reason: (err as Error)?.message ?? "unknown" });
      await sleep(wait);
    }
  }
  throw lastErr;
}

/**
 * Retry ciblé sur les codes HTTP transitoires (429, 502, 503, 504) et les
 * erreurs réseau. `fn` doit renvoyer la `Response` (pas encore parsée),
 * ce helper décide s'il faut retry en fonction du statut.
 *
 * ⚠️ Le body de la Response n'est pas consommé ici — l'appelant doit
 * `await response.json()` / `.text()` en aval.
 */
export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  return withHttpRetry(async () => {
    const response = await fetch(input, init);
    if (isTransientStatus(response.status)) {
      throw new HttpRetryError(response.status, `HTTP ${response.status}`);
    }
    return response;
  }, opts);
}

/** true si le statut mérite un retry (rate-limit, erreurs serveur transitoires). */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export class HttpRetryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpRetryError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
