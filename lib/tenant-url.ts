/**
 * Résout l'URL de base publique (`https://<host>`) du tenant courant.
 *
 * Sert à construire toute URL sortante qui doit refléter le domaine du
 * visiteur : liens dans les emails (reset mot de passe, notifications de
 * commande, chat, réclamations), URLs SEO (Open Graph, canonical, JSON-LD),
 * redirections de logout, etc.
 *
 * ⚠️ Ne pas confondre avec `NEXTAUTH_URL` : cette variable est **fixée** à
 * un unique domaine (beliandjolie.com en prod) et sert d'ancre à NextAuth.
 * L'utiliser pour bâtir des URLs sortantes dans un contexte multi-tenant
 * produit des liens Beli & Jolie pour des visiteurs Issyma, et vice-versa.
 *
 * Ordre de résolution :
 *   1. `Host:` header courant de la requête (cas nominal). Le protocole vient
 *      de `x-forwarded-proto` (Nginx en prod) ou est inféré (`http` en local).
 *   2. `TenantDomain.host` du tenant courant via l'ALS. Utile pour les jobs
 *      fire-and-forget correctement wrappés dans `tenantALS.run(tid, …)`
 *      (workers de queue, IIFE lancés depuis un handler).
 *   3. `NEXTAUTH_URL` env. Ultime filet quand ni requête ni ALS ne fournissent
 *      de contexte (scripts CLI, tests unitaires sans mock).
 */
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

async function fromCurrentRequest(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return null;
    const forwarded = h.get("x-forwarded-proto");
    const proto = forwarded
      ? forwarded.split(",")[0]!.trim()
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

async function fromTenantAls(): Promise<string | null> {
  const tid = getCurrentTenantIdSync();
  if (!tid) return null;
  try {
    const domain = await prisma.tenantDomain.findFirst({
      where: { tenantId: tid },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { host: true },
    });
    if (!domain) return null;
    return `https://${domain.host}`;
  } catch {
    return null;
  }
}

function fromEnv(): string {
  const raw = process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export async function getCurrentTenantBaseUrl(): Promise<string> {
  const fromReq = await fromCurrentRequest();
  if (fromReq) return fromReq.replace(/\/$/, "");
  const fromAls = await fromTenantAls();
  if (fromAls) return fromAls.replace(/\/$/, "");
  return fromEnv();
}
