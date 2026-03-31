/**
 * eFashion Paris GraphQL client
 *
 * Cookie-based auth with automatic reconnection.
 * All GraphQL requests go through efashionQuery/efashionMutation.
 */

import { logger } from "@/lib/logger";

const EFASHION_GRAPHQL_URL = "https://wapi.efashion-paris.com/graphql";
const EFASHION_BASE_URL = "https://wapi.efashion-paris.com";

export { EFASHION_GRAPHQL_URL, EFASHION_BASE_URL };

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

let cachedCookie: string | null = null;
let cookieExpiresAt: number = 0;

export function getEfashionCookie(): string | null {
  if (cachedCookie && Date.now() < cookieExpiresAt) {
    return cachedCookie;
  }
  return null;
}

export function setEfashionCookie(cookie: string, maxAgeSeconds: number = 604800): void {
  cachedCookie = cookie;
  cookieExpiresAt = Date.now() + (maxAgeSeconds - 600) * 1000;
}

export function invalidateEfashionCookie(): void {
  cachedCookie = null;
  cookieExpiresAt = 0;
}

/**
 * Execute a GraphQL query or mutation against eFashion API.
 */
export async function efashionGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  cookie?: string
): Promise<T> {
  const authCookie = cookie || getEfashionCookie();
  if (!authCookie) {
    throw new Error("eFashion non authentifié — cookie manquant");
  }

  const res = await fetch(EFASHION_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: authCookie,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eFashion GraphQL error (${res.status}): ${text}`);
  }

  const json: GraphQLResponse<T> = await res.json();

  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    logger.error("[eFashion GraphQL] Errors:", { errors: json.errors });
    throw new Error(`eFashion GraphQL: ${msg}`);
  }

  if (!json.data) {
    throw new Error("eFashion GraphQL: empty response (no data)");
  }

  return json.data;
}

/**
 * Make an authenticated REST request to eFashion.
 */
export async function efashionREST(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const authCookie = getEfashionCookie();
  if (!authCookie) {
    throw new Error("eFashion non authentifié — cookie manquant");
  }

  const url = path.startsWith("http") ? path : `${EFASHION_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: authCookie,
    },
  });
}
