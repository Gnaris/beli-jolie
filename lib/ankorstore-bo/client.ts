/**
 * Client HTTP pour le back-office Ankorstore.
 *
 * Injecte automatiquement Cookie + X-Aks-Csrf + X-Device-Id sur chaque appel.
 * Gère les 419 (session expirée) en re-loguant une fois puis en retryant.
 * Retry léger sur 429 / 5xx avec backoff.
 */

import { ANKORSTORE_BO_BASE_URL, getBoSession, invalidateBoSession, _boBaseHeaders } from "./auth";
import { logger } from "@/lib/logger";
import type { BoSession, BoValidationError } from "./types";

interface RequestOptions {
  session?: BoSession;
  extraHeaders?: Record<string, string>;
  /** Timeout en ms. Défaut 60s. */
  timeoutMs?: number;
  /** Nombre max de retries sur 429/5xx. Défaut 2. */
  maxRetries?: number;
}

export class BoApiError extends Error {
  status: number;
  body: string;
  validation?: BoValidationError;

  constructor(status: number, body: string, validation?: BoValidationError) {
    super(
      validation?.message ??
        `Ankorstore back-office : HTTP ${status} — ${body.slice(0, 200)}`
    );
    this.status = status;
    this.body = body;
    this.validation = validation;
  }
}

/** GET JSON. Ne nécessite pas de CSRF côté Ankor. */
export async function boGet<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return doRequest<T>("GET", path, undefined, opts);
}

/** POST JSON. Inclut automatiquement X-Aks-Csrf. */
export async function boPostJson<T>(
  path: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return doRequest<T>("POST", path, body, opts);
}

/** PUT JSON. Inclut automatiquement X-Aks-Csrf. */
export async function boPutJson<T>(
  path: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return doRequest<T>("PUT", path, body, opts);
}

/** DELETE. Inclut automatiquement X-Aks-Csrf. */
export async function boDelete<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return doRequest<T>("DELETE", path, undefined, opts);
}

/** POST multipart/form-data (upload d'image). Un seul champ `file` accepté. */
export async function boPostMultipart<T>(
  path: string,
  form: FormData,
  opts: RequestOptions = {}
): Promise<T> {
  const session = opts.session ?? (await getBoSession());
  const url = path.startsWith("http") ? path : `${ANKORSTORE_BO_BASE_URL}${path}`;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ..._boBaseHeaders(session.deviceId),
        Cookie: session.cookieHeader,
        "X-Aks-Csrf": session.csrfToken,
        "X-Csrf-Token": session.csrfToken,
        ...opts.extraHeaders,
      },
      body: form,
      redirect: "manual",
      signal: controller.signal,
    });

    if (res.status === 419 || res.status === 401) {
      invalidateBoSession(session.tenantId);
      if ((opts.maxRetries ?? 2) > 0) {
        return boPostMultipart<T>(path, form, {
          ...opts,
          session: undefined,
          maxRetries: (opts.maxRetries ?? 2) - 1,
        });
      }
    }

    return handleResponse<T>(res, "POST", url);
  } finally {
    clearTimeout(timeout);
  }
}

async function doRequest<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions
): Promise<T> {
  const session = opts.session ?? (await getBoSession());
  const url = path.startsWith("http") ? path : `${ANKORSTORE_BO_BASE_URL}${path}`;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;

  const headers: Record<string, string> = {
    ..._boBaseHeaders(session.deviceId),
    Cookie: session.cookieHeader,
    Accept: "application/json",
    ...opts.extraHeaders,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (method !== "GET") {
    headers["X-Aks-Csrf"] = session.csrfToken;
    headers["X-Csrf-Token"] = session.csrfToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });

    // Session expirée → re-login une fois
    if ((res.status === 419 || res.status === 401) && maxRetries > 0) {
      invalidateBoSession(session.tenantId);
      return doRequest<T>(method, path, body, {
        ...opts,
        session: undefined,
        maxRetries: maxRetries - 1,
      });
    }

    // Rate limit ou server error → retry avec backoff
    if ((res.status === 429 || res.status >= 500) && maxRetries > 0) {
      const backoff = res.status === 429 ? 2_000 : 1_000;
      await new Promise((r) => setTimeout(r, backoff));
      return doRequest<T>(method, path, body, {
        ...opts,
        maxRetries: maxRetries - 1,
      });
    }

    return handleResponse<T>(res, method, url);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleResponse<T>(res: Response, method: string, url: string): Promise<T> {
  const text = await res.text();

  if (res.status === 204) return undefined as T;

  if (res.status >= 200 && res.status < 300) {
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      logger.warn("[ankorstore-bo] réponse non-JSON", { method, url, status: res.status });
      return text as unknown as T;
    }
  }

  // Erreur — tenter parse Laravel validation
  let validation: BoValidationError | undefined;
  try {
    const parsed = JSON.parse(text) as Partial<BoValidationError>;
    if (parsed?.errors && typeof parsed.errors === "object") {
      validation = { message: parsed.message ?? "", errors: parsed.errors };
    }
  } catch {
    /* body n'est pas JSON */
  }

  throw new BoApiError(res.status, text, validation);
}
