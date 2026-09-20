/**
 * Constantes et types partagés entre le helper serveur `lib/tenant-preview`
 * et le composant client `TenantDevSwitcher`. Ce module est SANS dépendance
 * serveur (pas de `next/headers`, pas de Prisma) pour pouvoir être importé
 * depuis un composant `"use client"`.
 */

export const TENANT_PREVIEW_COOKIE = "bj_home_preview";

export type TenantSlug = "beliandjolie" | "issyma";
