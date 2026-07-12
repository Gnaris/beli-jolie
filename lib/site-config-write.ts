/**
 * Helpers d'écriture SiteConfig compatibles multi-tenant.
 *
 * La table SiteConfig a une PK composite `(tenantId, key)`. On ne peut plus
 * faire `siteConfig.upsert({ where: { key } })` — Prisma exige la clé unique
 * complète. Ces helpers passent par `updateMany` + `create` : l'extension
 * `tenantScopeExtension` (lib/prisma-tenant-scope.ts) injecte automatiquement
 * `tenantId` dans le `where` du `updateMany` et dans le `data` du `create`.
 *
 * Hors contexte requête (scripts CLI), l'extension est passthrough — dans ce
 * cas, il faut passer explicitement `tenantId` en 2ᵉ argument.
 */
import { prisma } from "@/lib/prisma";

/**
 * Insère ou met à jour la valeur d'une clé de config.
 *
 * @param key   clé (ex: "maintenance_mode")
 * @param value valeur (String)
 * @param opts.tenantId requis uniquement en dehors d'un contexte requête
 *                     (scripts, seeds). Ignoré sinon (extension gère le scope).
 */
export async function setSiteConfig(
  key: string,
  value: string,
  opts?: { tenantId?: string }
): Promise<void> {
  if (opts?.tenantId) {
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId: opts.tenantId, key } },
      update: { value },
      create: { tenantId: opts.tenantId, key, value },
    });
    return;
  }
  const updated = await prisma.siteConfig.updateMany({
    where: { key },
    data: { value },
  });
  if (updated.count === 0) {
    // tenantId injecté par l'extension `tenantScopeExtension`. Cast requis car
    // le type Prisma exige tenantId dans data (PK composite).
    await prisma.siteConfig.create({
      data: { key, value } as unknown as Parameters<typeof prisma.siteConfig.create>[0]["data"],
    });
  }
}

/**
 * Supprime une clé (no-op si absente). Bypass safe — l'extension scope au
 * tenant courant automatiquement.
 */
export async function unsetSiteConfig(
  key: string,
  opts?: { tenantId?: string }
): Promise<void> {
  if (opts?.tenantId) {
    await prisma.siteConfig.deleteMany({
      where: { tenantId: opts.tenantId, key },
    });
    return;
  }
  await prisma.siteConfig.deleteMany({ where: { key } });
}
