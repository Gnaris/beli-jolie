# Réactivation Ankorstore — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réactiver l'intégration Ankorstore (publish, update incrémental, refresh, delete, matching) en miroir de l'architecture PFS actuelle, en partageant la file de progression entre les deux marketplaces.

**Architecture:** Deux fichiers récupérés du commit `c68fe7b^` (auth) et `a33fcd1^` (match). Tout le reste réécrit à neuf en miroir des fichiers `lib/pfs-*.ts` (publish, refresh, update avec snapshot diff). `PfsRefreshContext` renommé en `MarketplaceRefreshContext` et étendu avec un champ `marketplace: "pfs" | "ankorstore"`. La modale "Enregistrer / Rafraîchir" affiche désormais deux cases (PFS + Ankorstore). Suppression locale propage automatiquement à Ankorstore (différent de PFS).

**Tech Stack:** Next.js 16, Prisma 5.22, TypeScript, Tailwind v4, Vitest, sharp (image transcoding), nodemailer pas concerné. API Ankorstore = JSON:API + OAuth2 client_credentials.

**Spec source:** `docs/superpowers/specs/2026-05-10-ankorstore-reactivation-design.md`
**API doc:** `docs/ankorstore-api.md`

---

## Phase 1 — Schéma Prisma + paramètres + cache

Aucune action côté Ankorstore encore. On prépare juste le terrain.

### Task 1.1 : Ajouter les champs Prisma

**Files:**
- Modify: `prisma/schema.prisma:321-392` (modèle `Product`)
- Modify: `prisma/schema.prisma:447-483` (modèle `ProductColor`)

- [ ] **Step 1 : Ajouter les champs dans `Product`**

Dans `prisma/schema.prisma`, juste après `pfsLastSyncSnapshot Json?` (ligne ~377), ajouter :

```prisma
  // Ankorstore — identifiants et snapshot de la dernière sync réussie
  ankorsProductId        String?   @unique
  ankorsLastSyncSnapshot Json?
  ankorsLastRefreshedAt  DateTime?
```

Et dans le bloc d'index en bas du modèle (après `@@index([pfsProductId])`), ajouter :

```prisma
  @@index([ankorsProductId])
```

- [ ] **Step 2 : Ajouter le champ dans `ProductColor`**

Dans `prisma/schema.prisma`, juste après `pfsVariantId String?` (ligne ~473), ajouter :

```prisma
  // Identifiant variante Ankorstore — renseigné à la publication live
  ankorsVariantId String?
```

Et dans le bloc d'index, après `@@index([pfsVariantId])` :

```prisma
  @@index([ankorsVariantId])
```

- [ ] **Step 3 : Pousser le schéma**

```bash
npx prisma db push --skip-generate
npx prisma generate
```

Attendu : `Your database is now in sync with your Prisma schema.`

- [ ] **Step 4 : Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(ankorstore): ajoute champs Prisma ankorsProductId/ankorsVariantId/snapshot"
```

### Task 1.2 : Ajouter les clés sensibles à `SENSITIVE_KEYS`

**Files:**
- Modify: `lib/encryption.ts:16-21`

- [ ] **Step 1 : Étendre la liste**

Remplacer le bloc `SENSITIVE_KEYS` :

```ts
export const SENSITIVE_KEYS = new Set([
  "easy_express_api_key",
  "deepl_api_key",
  "pfs_email",
  "pfs_password",
  "ankors_client_id",
  "ankors_client_secret",
]);
```

- [ ] **Step 2 : Commit**

```bash
git add lib/encryption.ts
git commit -m "feat(ankorstore): chiffre client_id et client_secret en base"
```

### Task 1.3 : Ajouter les helpers cachés Ankorstore

**Files:**
- Modify: `lib/cached-data.ts` (juste après le bloc `getCachedPfsCredentials`, ~ligne 266)

- [ ] **Step 1 : Ajouter trois helpers en miroir des helpers PFS**

```ts
// ─── Ankorstore — credentials, enabled, has-config (mêmes patterns que PFS) ──
export const getCachedAnkorstoreCredentials = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
    });
    const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
    return {
      clientId: map.get("ankors_client_id") ?? null,
      clientSecret: map.get("ankors_client_secret") ?? null,
    };
  },
  ["ankorstore-credentials"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedHasAnkorstoreConfig = unstable_cache(
  async () => {
    const row = await prisma.siteConfig.findUnique({
      where: { key: "ankors_client_id" },
      select: { key: true },
    });
    return !!row;
  },
  ["has-ankorstore-config"],
  { revalidate: 300, tags: ["site-config"] }
);

export const getCachedAnkorstoreEnabled = unstable_cache(
  async () => {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: ["ankors_client_id", "ankors_enabled"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const hasId = map.has("ankors_client_id");
    const enabled = map.get("ankors_enabled");
    return hasId && enabled !== "false";
  },
  ["ankorstore-enabled"],
  { revalidate: 300, tags: ["site-config"] }
);
```

- [ ] **Step 2 : Commit**

```bash
git add lib/cached-data.ts
git commit -m "feat(ankorstore): helpers de cache pour credentials et flag enabled"
```

### Task 1.4 : Server actions site-config Ankorstore

**Files:**
- Modify: `app/actions/admin/site-config.ts` (ajouter à la fin avant la dernière `}`)

- [ ] **Step 1 : Ajouter `updateAnkorstoreCredentials`, `validateAnkorstoreCredentials`, `toggleAnkorstoreEnabled`**

Calquer exactement le pattern de `updatePfsCredentials` / `validatePfsCredentials` / `togglePfsEnabled` (lignes 224-296). Schéma :

```ts
export async function updateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.siteConfig.upsert({
      where: { key: "ankors_client_id" },
      update: { value: encryptIfSensitive("ankors_client_id", config.clientId) },
      create: { key: "ankors_client_id", value: encryptIfSensitive("ankors_client_id", config.clientId) },
    });
    await prisma.siteConfig.upsert({
      where: { key: "ankors_client_secret" },
      update: { value: encryptIfSensitive("ankors_client_secret", config.clientSecret) },
      create: { key: "ankors_client_secret", value: encryptIfSensitive("ankors_client_secret", config.clientSecret) },
    });
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function toggleAnkorstoreEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  try {
    await prisma.siteConfig.upsert({
      where: { key: "ankors_enabled" },
      update: { value: enabled ? "true" : "false" },
      create: { key: "ankors_enabled", value: enabled ? "true" : "false" },
    });
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function validateAnkorstoreCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<{ valid: boolean; error?: string }> {
  await requireAdmin();
  // Import dynamique pour éviter de charger le module Ankorstore quand pas appelé
  const { testAnkorstoreCredentials } = await import("@/lib/ankorstore-auth");
  return testAnkorstoreCredentials(config.clientId, config.clientSecret);
}
```

- [ ] **Step 2 : Étendre `updateMarketplaceMarkup` pour accepter les marges Ankorstore**

La signature actuelle (~ligne 510) prend `{ pfs: MarkupState }`. La passer à `{ pfs?: MarkupState; ankorstoreWholesale?: MarkupState; ankorstoreRetail?: MarkupState; ankorstoreVatRate?: number }` et ajouter, pour chaque clé optionnelle, un upsert sur la clé SiteConfig correspondante :

```
ankorstore_wholesale_markup_type / _value / _rounding
ankorstore_retail_markup_type    / _value / _rounding
ankorstore_default_vat_rate
```

Ajouter le tag `revalidateTag("site-config", "default")` à la fin (existe déjà).

- [ ] **Step 3 : Commit**

```bash
git add app/actions/admin/site-config.ts
git commit -m "feat(ankorstore): server actions credentials + marges + VAT"
```

### Task 1.5 : Étendre la carte `MarketplaceConfig` Paramètres

**Files:**
- Modify: `components/admin/settings/MarketplaceConfig.tsx`
- Modify: `app/(admin)/admin/parametres/page.tsx` (lecture des nouvelles clés + props)

- [ ] **Step 1 : Étendre `Props`**

Dans `MarketplaceConfig.tsx`, modifier l'interface `Props` :

```ts
interface Props {
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  markupSettings: {
    pfs: MarkupState;
    ankorstoreWholesale: MarkupState;
    ankorstoreRetail: MarkupState;
    ankorstoreVatRate: number;
  };
}
```

- [ ] **Step 2 : Dupliquer la carte PFS pour Ankorstore**

Le bloc `<div className="bg-bg-primary border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">` (ligne 297) sert de modèle. Créer un second bloc identique côte-à-côte (déjà dans une grid `lg:grid-cols-2`) avec :
- Titre "Ankorstore"
- Toggle "Activer la sync Ankorstore" (case en haut, `ankors_enabled`)
- Champs `client_id` / `client_secret` au lieu de `email` / `password`
- Boutons "Tester la connexion" + "Sauvegarder" qui appellent `validateAnkorstoreCredentials` / `updateAnkorstoreCredentials`
- Deux blocs `MarkupRow` : "Prix de gros" et "Prix public conseillé"
- Un input number pour TVA (label "TVA par défaut (%)", placeholder "20")

- [ ] **Step 3 : Étendre `handleSaveMarkup`**

```ts
const result = await updateMarketplaceMarkup({
  pfs: pfsMarkup,
  ankorstoreWholesale: ankorstoreWholesale,
  ankorstoreRetail: ankorstoreRetail,
  ankorstoreVatRate: ankorstoreVatRate,
});
```

- [ ] **Step 4 : Mettre à jour `app/(admin)/admin/parametres/page.tsx`**

Charger en parallèle les nouvelles clés via `Promise.all` et passer au composant :

```ts
const [
  /* existant... */
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  ankorstoreWholesaleType, ankorstoreWholesaleValue, ankorstoreWholesaleRounding,
  ankorstoreRetailType, ankorstoreRetailValue, ankorstoreRetailRounding,
  ankorstoreVatRate,
] = await Promise.all([
  /* existant... */
  getCachedHasAnkorstoreConfig(),
  getCachedAnkorstoreEnabled(),
  getCachedSiteConfig("ankorstore_wholesale_markup_type"),
  getCachedSiteConfig("ankorstore_wholesale_markup_value"),
  getCachedSiteConfig("ankorstore_wholesale_markup_rounding"),
  getCachedSiteConfig("ankorstore_retail_markup_type"),
  getCachedSiteConfig("ankorstore_retail_markup_value"),
  getCachedSiteConfig("ankorstore_retail_markup_rounding"),
  getCachedSiteConfig("ankorstore_default_vat_rate"),
]);
```

- [ ] **Step 5 : Commit**

```bash
git add components/admin/settings/MarketplaceConfig.tsx app/\(admin\)/admin/parametres/page.tsx
git commit -m "feat(ankorstore): carte Paramètres > Marketplaces avec credentials et marges"
```

### Task 1.6 : Validation locale Phase 1

- [ ] Aller dans `Admin > Paramètres > Marketplaces`. La carte Ankorstore est présente, vide.
- [ ] Saisir des identifiants OAuth2 bidons → cliquer "Tester la connexion" → toast d'erreur attendu.
- [ ] Sauvegarder, vérifier dans `prisma studio` que `SiteConfig.ankors_client_id` commence par `enc:v1:`.
- [ ] Commit final si toutes les vérifs OK.

---

## Phase 2 — Briques métier `lib/ankorstore-*.ts` + tests

Toujours invisible côté admin. On construit les briques, on les teste isolément.

### Task 2.1 : Restaurer `lib/ankorstore-auth.ts` depuis le commit `c68fe7b^`

**Files:**
- Create: `lib/ankorstore-auth.ts`

- [ ] **Step 1 : Récupérer le contenu**

```bash
git show c68fe7b^:lib/ankorstore-auth.ts > lib/ankorstore-auth.ts
```

Le fichier (158 lignes) implémente :
- `ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1"`
- `getAnkorstoreToken()` — cache en mémoire + buffer 5 min, lit les credentials via `getCachedAnkorstoreCredentials()`
- `getAnkorstoreHeaders()` — Bearer + `Accept: application/vnd.api+json` + `User-Agent`
- `invalidateAnkorstoreToken()` — vidange après 401
- `testAnkorstoreCredentials(clientId, clientSecret)` — sans cache, retourne `{ valid, error? }`

- [ ] **Step 2 : Vérifier que ça compile**

```bash
npx tsc --noEmit lib/ankorstore-auth.ts
```

Attendu : 0 erreur. `getCachedAnkorstoreCredentials` doit exister (Task 1.3).

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-auth.ts
git commit -m "feat(ankorstore): restaure le client OAuth2 (auth + cache token)"
```

### Task 2.2 : Restaurer `lib/ankorstore-match.ts` depuis le commit `a33fcd1^`

**Files:**
- Create: `lib/ankorstore-match.ts`

- [ ] **Step 1 : Récupérer le contenu**

```bash
git show a33fcd1^:lib/ankorstore-match.ts > lib/ankorstore-match.ts
```

Le fichier (252 lignes) expose :
- `extractReference(product)` — cascade SKU 1er segment → nom après " - " → regex description
- `runAutoMatch(ankorstoreProducts, bjProducts)` — retourne `MatchReport { matched, ambiguous, unmatched, results[] }`
- `matchVariants()` interne — match couleurs par normalisation NFD lowercase

⚠️ Le fichier importe `import type { AnkorstoreProduct, AnkorstoreVariant } from "@/lib/ankorstore-api"` — `lib/ankorstore-api.ts` sera créé en Task 2.3, donc TypeScript va broncher temporairement. C'est attendu.

- [ ] **Step 2 : Commit**

```bash
git add lib/ankorstore-match.ts
git commit -m "feat(ankorstore): restaure le moteur de matching produit/variantes"
```

### Task 2.3 : Créer `lib/ankorstore-api.ts` (lecture)

**Files:**
- Create: `lib/ankorstore-api.ts`

Fonctions à exposer (en miroir de `lib/pfs-api.ts`) :
- `ankorstoreSearchProducts(query: string, limit = 20)` → `AnkorstoreProduct[]`
- `ankorstoreGetProduct(productId: string)` → `AnkorstoreProduct | null`
- `ankorstoreGetVariants(productId: string)` → `AnkorstoreVariant[]`
- `ankorstoreListAllProducts(opts?: { limit?: number })` → `AnkorstoreProduct[]` (utilisé par la page de matching, paginé via cursor `page[after]`)
- `ankorstoreFindVariantBySku(sku: string)` → `AnkorstoreVariant | null` (filter `?filter[sku]=…`)

Types JSON:API à exporter :
```ts
export interface AnkorstoreVariant {
  id: string;
  sku: string | null;
  ian: string | null;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  availableQuantity: number | null;
  stockQuantity: number | null;
  isAlwaysInStock: boolean;
  options?: { name: "color" | "size" | "material" | "style"; value: string }[];
  images?: { order: number; url: string }[];
}

export interface AnkorstoreProduct {
  id: string;
  name: string;
  description: string;
  retailPrice: number;
  wholesalePrice: number;
  vatRate: number;
  active: boolean;
  archived: boolean;
  images: { order: number; url: string }[];
  variants: AnkorstoreVariant[]; // hydraté via include=productVariant
}
```

- [ ] **Step 1 : Helper de fetch JSON:API**

Une fonction interne `ankorstoreFetch<T>(path, init?)` qui :
- Appelle `getAnkorstoreHeaders()` puis `fetch(${ANKORSTORE_BASE_URL}${path}, { ...init, headers })`
- Sur 401 → `invalidateAnkorstoreToken()` + 1 retry
- Sur 429 → lit `Retry-After`, attend, retry (max 3)
- Sur 5xx → backoff exponentiel (3 essais : 1s / 4s / 16s)
- Sur 4xx hors 429 → throw avec le body pour debug
- Logue `[Ankorstore]` à chaque retry

- [ ] **Step 2 : `ankorstoreFindVariantBySku`**

```ts
export async function ankorstoreFindVariantBySku(sku: string): Promise<AnkorstoreVariant | null> {
  const url = `/product-variants?filter[sku]=${encodeURIComponent(sku)}&page[limit]=1`;
  const resp = await ankorstoreFetch<{ data: { id: string; attributes: AnkorstoreVariant }[] }>(url);
  if (!resp.data?.length) return null;
  return { ...resp.data[0].attributes, id: resp.data[0].id };
}
```

- [ ] **Step 3 : `ankorstoreListAllProducts` (cursor pagination)**

```ts
export async function ankorstoreListAllProducts(opts?: { pageSize?: number }): Promise<AnkorstoreProduct[]> {
  const pageSize = opts?.pageSize ?? 50;
  const all: AnkorstoreProduct[] = [];
  let after: string | null = null;
  for (let i = 0; i < 200; i++) { // safety break à 200 * 50 = 10k produits
    const cursor = after ? `&page[after]=${after}` : "";
    const url = `/products?include=productVariant&page[limit]=${pageSize}${cursor}`;
    const resp = await ankorstoreFetch<{
      data: { id: string; attributes: AnkorstoreProduct; relationships?: { productVariant?: { data: { id: string }[] } } }[];
      included?: { id: string; attributes: AnkorstoreVariant }[];
      meta?: { page?: { hasMore?: boolean } };
      links?: { next?: string };
    }>(url);
    const variantsById = new Map((resp.included ?? []).map((v) => [v.id, { ...v.attributes, id: v.id }]));
    for (const item of resp.data) {
      const variantIds = item.relationships?.productVariant?.data?.map((v) => v.id) ?? [];
      all.push({ ...item.attributes, id: item.id, variants: variantIds.map((id) => variantsById.get(id)).filter(Boolean) as AnkorstoreVariant[] });
    }
    if (!resp.meta?.page?.hasMore || resp.data.length < pageSize) break;
    after = resp.data[resp.data.length - 1].id;
  }
  return all;
}
```

- [ ] **Step 4 : Compiler**

```bash
npx tsc --noEmit
```

Plus aucune erreur sur `lib/ankorstore-match.ts` ni `lib/ankorstore-api.ts`.

- [ ] **Step 5 : Commit**

```bash
git add lib/ankorstore-api.ts
git commit -m "feat(ankorstore): client API lecture (search, get, list, find by SKU)"
```

### Task 2.4 : Créer `lib/ankorstore-pricing.ts`

**Files:**
- Create: `lib/ankorstore-pricing.ts`

Différence avec `lib/marketplace-pricing.ts` : Ankorstore a **deux marges séparées** (wholesale + retail), pas une seule.

- [ ] **Step 1 : Export du module**

```ts
import { prisma } from "@/lib/prisma";
import { applyMarketplaceMarkup, type MarkupConfig, type MarkupType, type RoundingMode } from "@/lib/marketplace-pricing";

export interface AnkorstorePricingConfig {
  wholesale: MarkupConfig;
  retail: MarkupConfig;
  vatRate: number;
}

export async function loadAnkorstorePricingConfig(): Promise<AnkorstorePricingConfig> {
  const keys = [
    "ankorstore_wholesale_markup_type",
    "ankorstore_wholesale_markup_value",
    "ankorstore_wholesale_markup_rounding",
    "ankorstore_retail_markup_type",
    "ankorstore_retail_markup_value",
    "ankorstore_retail_markup_rounding",
    "ankorstore_default_vat_rate",
  ];
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parse = (prefix: string): MarkupConfig => ({
    type: (map.get(`${prefix}_type`) as MarkupType) || "percent",
    value: Number(map.get(`${prefix}_value`)) || 0,
    rounding: (map.get(`${prefix}_rounding`) as RoundingMode) || "none",
  });

  return {
    wholesale: parse("ankorstore_wholesale_markup"),
    retail: parse("ankorstore_retail_markup"),
    vatRate: Number(map.get("ankorstore_default_vat_rate")) || 20,
  };
}

/**
 * Pour un PACK : on calcule le prix unitaire (total ÷ qty), on applique le
 * markup, on arrondit, puis on multiplie par packQuantity. JAMAIS markup sur
 * le total directement (cohérent avec lib/pfs-publish.ts:getPfsUnitPrice).
 */
export function getAnkorstorePackedPrice(
  unitPriceTotal: number,
  packQuantity: number | null,
  saleType: "UNIT" | "PACK",
  markup: MarkupConfig,
): number {
  if (saleType !== "PACK") return applyMarketplaceMarkup(unitPriceTotal, markup);
  const qty = packQuantity && packQuantity > 0 ? packQuantity : 1;
  const perUnit = Math.round((unitPriceTotal / qty) * 100) / 100;
  const withMarkup = applyMarketplaceMarkup(perUnit, markup);
  return Math.round(withMarkup * qty * 100) / 100;
}

/** Convertit un prix en euros vers les centimes attendus par l'API Ankorstore. */
export function toCents(amountEur: number): number {
  return Math.round(amountEur * 100);
}
```

- [ ] **Step 2 : Commit**

```bash
git add lib/ankorstore-pricing.ts
git commit -m "feat(ankorstore): module de pricing (wholesale + retail séparés, helpers cents)"
```

### Task 2.5 : Tests `lib/ankorstore-pricing.ts`

**Files:**
- Create: `__tests__/lib/ankorstore-pricing.test.ts`

- [ ] **Step 1 : Écrire les tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAnkorstorePackedPrice, toCents, loadAnkorstorePricingConfig } from "@/lib/ankorstore-pricing";

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findMany: vi.fn() } },
}));

describe("getAnkorstorePackedPrice", () => {
  it("UNIT — applique le markup directement", () => {
    expect(getAnkorstorePackedPrice(10, null, "UNIT", { type: "percent", value: 50, rounding: "none" })).toBe(15);
  });

  it("PACK — markup sur prix unitaire puis × quantité", () => {
    // Pack de 6 à 60€ total = 10€/u → +50% = 15€/u → ×6 = 90€
    expect(getAnkorstorePackedPrice(60, 6, "PACK", { type: "percent", value: 50, rounding: "none" })).toBe(90);
  });

  it("PACK avec arrondi up — arrondit le prix unitaire avant multiplication", () => {
    // 60€ ÷ 6 = 10€ → +33% = 13.30€ → arrondi up = 14€ → ×6 = 84€
    expect(getAnkorstorePackedPrice(60, 6, "PACK", { type: "percent", value: 33, rounding: "up" })).toBe(84);
  });

  it("packQuantity null/0 → traité comme 1", () => {
    expect(getAnkorstorePackedPrice(10, null, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
    expect(getAnkorstorePackedPrice(10, 0, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
  });
});

describe("toCents", () => {
  it("convertit euros vers centimes", () => {
    expect(toCents(15)).toBe(1500);
    expect(toCents(15.45)).toBe(1545);
    expect(toCents(15.456)).toBe(1546); // arrondi
  });
});

describe("loadAnkorstorePricingConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne les valeurs par défaut si rien en BDD", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([]);
    const cfg = await loadAnkorstorePricingConfig();
    expect(cfg.wholesale).toEqual({ type: "percent", value: 0, rounding: "none" });
    expect(cfg.retail).toEqual({ type: "percent", value: 0, rounding: "none" });
    expect(cfg.vatRate).toBe(20);
  });

  it("lit les clés existantes", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([
      { key: "ankorstore_wholesale_markup_type", value: "percent" },
      { key: "ankorstore_wholesale_markup_value", value: "30" },
      { key: "ankorstore_wholesale_markup_rounding", value: "up" },
      { key: "ankorstore_default_vat_rate", value: "5.5" },
    ] as never);
    const cfg = await loadAnkorstorePricingConfig();
    expect(cfg.wholesale).toEqual({ type: "percent", value: 30, rounding: "up" });
    expect(cfg.vatRate).toBe(5.5);
  });
});
```

- [ ] **Step 2 : Lancer**

```bash
npm test -- __tests__/lib/ankorstore-pricing.test.ts
```

Attendu : 7 tests verts.

- [ ] **Step 3 : Commit**

```bash
git add __tests__/lib/ankorstore-pricing.test.ts
git commit -m "test(ankorstore): pricing wholesale/retail/PACK + arrondis + cents"
```

### Task 2.6 : Créer `lib/ankorstore-sync-diff.ts`

**Files:**
- Create: `lib/ankorstore-sync-diff.ts`

Calque de `lib/pfs-sync-diff.ts` (192 lignes) avec adaptations Ankorstore. Différences :
- Pas de `bestSellerChanged` (Ankorstore a `tags` au lieu — pas géré dans cette V1)
- `defaultColorChanged` reste (champ `images.main_image`)
- `statusChanged` → mappe `active` + `archived`
- Variant inclut `wholesalePriceCents` + `retailPriceCents` + `stockQty` + `isAlwaysInStock`

- [ ] **Step 1 : Définir les types**

```ts
export const ANKORSTORE_SNAPSHOT_VERSION = 1 as const;

export interface AnkorstoreProductFieldsSnapshot {
  externalId: string;       // Product.reference
  name: string;
  description: string;      // ce qu'on a envoyé (formaté + ref + composition)
  vatRate: number;
  countryCode: string;      // ISO 2-letters
  unitMultiplier: number;
  brandName: string;
}

export interface AnkorstoreVariantSnapshot {
  sku: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  stockQty: number;
  isAlwaysInStock: boolean;
  optionColor: string;
  optionSize: string;
}

export type AnkorstoreImagesSnapshot = {
  [colorKey: string]: { [slotKey: string]: string }; // path local
};

export type AnkorstoreStatus = "active" | "inactive" | "archived";

export interface AnkorstoreSyncSnapshot {
  schemaVersion: typeof ANKORSTORE_SNAPSHOT_VERSION;
  product: AnkorstoreProductFieldsSnapshot;
  variants: { [ankorsVariantId: string]: AnkorstoreVariantSnapshot };
  images: AnkorstoreImagesSnapshot;
  status: AnkorstoreStatus;
}

export interface AnkorstoreSyncDiff {
  productChanged: boolean;
  variantsChanged: string[];
  variantsToCreate: string[]; // SKUs locaux sans ankorsVariantId mappé dans prev
  imagesToUpload: { colorKey: string; slot: number; path: string }[];
  imagesToDelete: { colorKey: string; slot: number }[];
  statusChanged: boolean;
}
```

- [ ] **Step 2 : Écrire `diffAnkorstoreSnapshots(prev, next)` et `diffIsEmpty(diff)`**

Logique identique à `lib/pfs-sync-diff.ts:diffSnapshots` (lignes 100-176) adaptée aux types ci-dessus. Si `prev` est null → tout est marqué comme à envoyer.

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-sync-diff.ts
git commit -m "feat(ankorstore): types et fonction diff de snapshot pour update incrémental"
```

### Task 2.7 : Tests `lib/ankorstore-sync-diff.ts`

**Files:**
- Create: `__tests__/lib/ankorstore-sync-diff.test.ts`

- [ ] **Step 1 : Tests de chaque cas**

```ts
import { describe, it, expect } from "vitest";
import {
  diffAnkorstoreSnapshots,
  diffIsEmpty,
  ANKORSTORE_SNAPSHOT_VERSION,
  type AnkorstoreSyncSnapshot,
} from "@/lib/ankorstore-sync-diff";

const baseSnap: AnkorstoreSyncSnapshot = {
  schemaVersion: ANKORSTORE_SNAPSHOT_VERSION,
  product: { externalId: "REF1", name: "P", description: "D", vatRate: 20, countryCode: "FR", unitMultiplier: 1, brandName: "B" },
  variants: { "v1": { sku: "REF1_R_UNIT_1", wholesalePriceCents: 1500, retailPriceCents: 3000, stockQty: 10, isAlwaysInStock: false, optionColor: "Rouge", optionSize: "M" } },
  images: { "Rouge": { "1": "/uploads/produits/ref1/img-1.webp" } },
  status: "active",
};

it("snapshot null → tout à envoyer", () => {
  const diff = diffAnkorstoreSnapshots(null, baseSnap);
  expect(diff.productChanged).toBe(true);
  expect(diff.statusChanged).toBe(true);
  expect(diff.variantsChanged).toEqual(["v1"]);
  expect(diff.imagesToUpload).toHaveLength(1);
});

it("snapshots identiques → diff vide", () => {
  const diff = diffAnkorstoreSnapshots(baseSnap, baseSnap);
  expect(diffIsEmpty(diff)).toBe(true);
});

it("change le stock d'une variante → seule cette variante change", () => {
  const next = { ...baseSnap, variants: { ...baseSnap.variants, v1: { ...baseSnap.variants.v1, stockQty: 5 } } };
  const diff = diffAnkorstoreSnapshots(baseSnap, next);
  expect(diff.variantsChanged).toEqual(["v1"]);
  expect(diff.productChanged).toBe(false);
});

it("ajoute une image → upload uniquement le slot ajouté", () => {
  const next: AnkorstoreSyncSnapshot = { ...baseSnap, images: { Rouge: { "1": "/uploads/produits/ref1/img-1.webp", "2": "/uploads/produits/ref1/img-2.webp" } } };
  const diff = diffAnkorstoreSnapshots(baseSnap, next);
  expect(diff.imagesToUpload).toEqual([{ colorKey: "Rouge", slot: 2, path: "/uploads/produits/ref1/img-2.webp" }]);
  expect(diff.imagesToDelete).toEqual([]);
});

it("remplace une image (même slot, path différent) → upload + pas de delete", () => {
  const next: AnkorstoreSyncSnapshot = { ...baseSnap, images: { Rouge: { "1": "/uploads/produits/ref1/img-1-v2.webp" } } };
  const diff = diffAnkorstoreSnapshots(baseSnap, next);
  expect(diff.imagesToUpload).toHaveLength(1);
  expect(diff.imagesToDelete).toEqual([]);
});

it("retire une image → delete uniquement", () => {
  const next: AnkorstoreSyncSnapshot = { ...baseSnap, images: {} };
  const diff = diffAnkorstoreSnapshots(baseSnap, next);
  expect(diff.imagesToUpload).toEqual([]);
  expect(diff.imagesToDelete).toEqual([{ colorKey: "Rouge", slot: 1 }]);
});

it("change le statut → statusChanged=true", () => {
  const next: AnkorstoreSyncSnapshot = { ...baseSnap, status: "archived" };
  const diff = diffAnkorstoreSnapshots(baseSnap, next);
  expect(diff.statusChanged).toBe(true);
});
```

- [ ] **Step 2 : Lancer + commit**

```bash
npm test -- __tests__/lib/ankorstore-sync-diff.test.ts
git add __tests__/lib/ankorstore-sync-diff.test.ts
git commit -m "test(ankorstore): diff de snapshot (variantes, images, statut)"
```

### Task 2.8 : Créer `lib/ankorstore-api-write.ts`

**Files:**
- Create: `lib/ankorstore-api-write.ts`

Fonctions exposées :
- `ankorstoreCreateCatalogOperation(type: "import" | "update" | "delete")` → `{ operationId }`
- `ankorstoreAddProductsToOperation(opId, products[])`
- `ankorstoreStartOperation(opId)` (PATCH `/operations/{id}`)
- `ankorstorePollOperation(opId, opts?: { timeoutMs?: number, intervalMs?: number })` → statut final `succeeded | partially_failed | failed` + résultats par produit (incluant `externalProductId` ↔ `id` Ankorstore généré)
- `ankorstorePatchVariantStock(variantId, stockQty | isAlwaysInStock)` (endpoint dédié `/product-variants/{id}/stock`)
- `ankorstorePatchVariantPrices(variantId, { wholesalePrice, retailPrice })` (endpoint dédié `/product-variants/{id}/prices`)
- `ankorstoreBatchUpdateVariants(updates[])` via `POST /operations` `atomic:operations` (max 50 par appel)
- `ankorstoreUploadImage(productId, buffer, slot, color)` — endpoint exact à confirmer par lecture de doc § 5.2 (ce sont les `images[]` au moment de la création / update)
- `ankorstoreDeleteProduct(externalIdOrAnkorsId)` — flow 3-steps : create delete operation → add product → start → poll
- `ankorstoreSearchProducts(query)` — wrapper read pour la page de matching

**Correctif bug `Could not archive SKUs`** : `ankorstoreDeleteProduct` retry 3 essais avec backoff exponentiel (1s, 4s, 16s). Si toujours échec, log enrichi (SKUs concernés, état Ankorstore retourné). On laisse le caller décider de la suppression locale.

- [ ] **Step 1 : Squelette + helpers**

```ts
import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL, invalidateAnkorstoreToken } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

async function ankorstoreFetchJson<T>(path: string, init?: RequestInit, retryCount = 0): Promise<T> {
  // ... (identique au helper read, y compris retries 401/429/5xx)
}

export interface AnkorstoreCatalogProductInput {
  externalId: string;
  name: string;
  description: string;
  mainImage?: string;
  images?: { order: number; url: string }[];
  currency: "EUR";
  vatRate: number;
  unitMultiplier: number;
  wholesalePrice: number; // en EUR (pas centimes)
  retailPrice: number;    // en EUR
  countryCode: string;    // ISO
  tags?: string[];
  variants: {
    sku: string;
    ian?: string | null;
    stockQuantity: number;
    isAlwaysInStock: boolean;
    options: { name: "color" | "size" | "material" | "style"; value: string }[];
  }[];
  shapeProperties?: { weight: { unitCode: "GRM"; amount: number } };
}
```

- [ ] **Step 2 : `ankorstoreCreateCatalogOperation`**

```ts
export async function ankorstoreCreateCatalogOperation(type: "import" | "update" | "delete"): Promise<{ operationId: string }> {
  const resp = await ankorstoreFetchJson<{ data: { id: string } }>(`/catalog/integrations/operations`, {
    method: "POST",
    body: JSON.stringify({
      data: { type: "catalog-integration-operation", attributes: { type, source: "other" } },
    }),
  });
  return { operationId: resp.data.id };
}
```

- [ ] **Step 3 : `ankorstoreAddProductsToOperation` + `ankorstoreStartOperation` + `ankorstorePollOperation`**

Voir `docs/ankorstore-api.md` § 5.2-5.4. La fonction `ankorstorePollOperation` interroge `/operations/{id}/results` toutes les 2 secondes (configurable), timeout par défaut 90s, retourne `{ status, results: { externalId, ankorstoreProductId | null, status, failureReason, issues }[] }`.

- [ ] **Step 4 : `ankorstoreDeleteProduct` avec retry**

```ts
export async function ankorstoreDeleteProduct(ankorsProductIdOrExternalId: string): Promise<void> {
  const delays = [0, 1000, 4000, 16000];
  let lastErr: unknown = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const { operationId } = await ankorstoreCreateCatalogOperation("delete");
      await ankorstoreAddProductsToOperation(operationId, [{ externalId: ankorsProductIdOrExternalId, type: "catalog-integration-product", attributes: {} } as never]);
      await ankorstoreStartOperation(operationId);
      const result = await ankorstorePollOperation(operationId);
      if (result.status === "succeeded") return;
      if (result.status === "partially_failed") {
        const archiveSkuFail = result.results.find((r) => r.failureReason?.includes("Could not archive SKUs"));
        if (archiveSkuFail) {
          lastErr = new Error(`[Ankorstore Delete] Could not archive SKUs: ${JSON.stringify(archiveSkuFail.issues)}`);
          logger.warn("[Ankorstore] Delete attempt failed (archive SKUs), retrying", { attempt: i + 1, productId: ankorsProductIdOrExternalId });
          continue;
        }
      }
      throw new Error(`[Ankorstore Delete] Operation finished with status ${result.status}`);
    } catch (err) {
      lastErr = err;
      if (i < delays.length - 1) continue;
    }
  }
  logger.error("[Ankorstore] Delete failed after retries", { productId: ankorsProductIdOrExternalId, error: lastErr });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
```

- [ ] **Step 5 : Commit**

```bash
git add lib/ankorstore-api-write.ts
git commit -m "feat(ankorstore): client API écriture (operations bulk + retry delete)"
```

### Task 2.9 : Tests delete-retry

**Files:**
- Create: `__tests__/lib/ankorstore-delete-retry.test.ts`

- [ ] **Step 1 : Mocker fetch + tester la séquence retry**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ankorstoreDeleteProduct } from "@/lib/ankorstore-api-write";

vi.mock("@/lib/ankorstore-auth", () => ({
  getAnkorstoreHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer x", Accept: "application/vnd.api+json" }),
  ANKORSTORE_BASE_URL: "https://www.ankorstore.com/api/v1",
  invalidateAnkorstoreToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as never;

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

it("succès au 1er essai → 1 séquence (create op → add → start → poll)", async () => {
  // 4 réponses : create op (id=op1), add products, start, poll succeeded
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "op1" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ attributes: { status: "succeeded" } }] }) });
  const promise = ankorstoreDeleteProduct("EXT-1");
  await vi.runAllTimersAsync();
  await promise;
  expect(mockFetch).toHaveBeenCalledTimes(4);
});

it("échec 'Could not archive SKUs' au 1er, succès au 2e → retry après 1s", async () => {
  // séquence 1 (échec) puis séquence 2 (succès)
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "op1" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ attributes: { status: "partially_failed", failureReason: "Could not archive SKUs", issues: [] } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "op2" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ attributes: { status: "succeeded" } }] }) });
  const promise = ankorstoreDeleteProduct("EXT-1");
  await vi.runAllTimersAsync();
  await promise;
  expect(mockFetch).toHaveBeenCalledTimes(8);
});

it("échec 4 fois → throw après 3 retries (1s + 4s + 16s)", async () => {
  // 4 séquences identiques, toutes en échec
  for (let i = 0; i < 4; i++) {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: `op${i}` } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ attributes: { status: "partially_failed", failureReason: "Could not archive SKUs", issues: ["sku-detail"] } }] }) });
  }
  const promise = ankorstoreDeleteProduct("EXT-1");
  await vi.runAllTimersAsync();
  await expect(promise).rejects.toThrow(/Could not archive SKUs/);
});
```

- [ ] **Step 2 : Lancer + commit**

```bash
npm test -- __tests__/lib/ankorstore-delete-retry.test.ts
git add __tests__/lib/ankorstore-delete-retry.test.ts
git commit -m "test(ankorstore): retry delete sur 'Could not archive SKUs' avec backoff"
```

### Task 2.10 : Créer `lib/ankorstore-publish.ts`

**Files:**
- Create: `lib/ankorstore-publish.ts`

Calque exact de `lib/pfs-publish.ts:323-763` (`pfsPublishProduct`) adapté à Ankorstore. Étapes :
1. Charger le produit complet depuis Prisma (same shape que `loadProductFull` dans `lib/pfs-publish.ts:170-232`)
2. Charger les markup configs (`loadAnkorstorePricingConfig()`)
3. `ankorstoreCreateCatalogOperation("import")` → `operationId`
4. Construire le `AnkorstoreCatalogProductInput` avec :
   - `externalId = product.reference`
   - `name = product.name`
   - `description = formatAnkorstoreDescription(product)` (composition + ref insérées en bas, voir Task 2.11)
   - `vatRate = pricing.vatRate`
   - `countryCode = product.manufacturingCountry?.isoCode ?? "FR"`
   - `unitMultiplier = 1` (par défaut)
   - `wholesalePrice = getAnkorstorePackedPrice(unitPriceTotal, packQuantity, saleType, pricing.wholesale)` sur la **première** variante (Ankorstore prend un prix produit + variantes contiennent prix dérivés ?). À confirmer en lecture doc § 5.2 — sinon, on calque la même logique que PFS et on envoie le prix par variante avec les patches stock+prix après création.
   - `variants = product.colors.map(buildAnkorstoreVariantInput)` — UNIT et PACK convertis (logique identique à pfs-publish lines 412-484)
5. `ankorstoreAddProductsToOperation(opId, [input])` → `ankorstoreStartOperation(opId)` → `ankorstorePollOperation(opId)`
6. Si `succeeded` : récupérer `ankorsProductId` + map `sku → ankorsVariantId`
7. Upload images (JPEG, calqué sur `pfs-publish.ts:573-629`)
8. Status update : si stock 0 partout → `archived = true`, sinon `active`
9. Sauvegarder en BDD :
   ```ts
   await prisma.$transaction([
     prisma.product.update({
       where: { id: productId },
       data: { ankorsProductId, ankorsLastSyncSnapshot: Prisma.DbNull, ...(allOOS ? { status: "OFFLINE" } : {}) },
     }),
     ...variantUpdates,
   ]);
   ```
10. Cleanup en cas d'erreur : si `ankorsProductId` créé mais étape ultérieure plante → `ankorstoreDeleteProduct(ankorsProductId)`.

- [ ] **Step 1 : Écrire le fichier**

Voir `lib/pfs-publish.ts` comme référence stricte. Garder le même type `FullProduct`/`FullVariant` (à exporter idéalement dans un module partagé `lib/marketplace-product-shape.ts` mais on duplique pour rester aligné, comme le fait actuellement PFS update vs publish).

- [ ] **Step 2 : Compiler**

```bash
npx tsc --noEmit
```

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-publish.ts
git commit -m "feat(ankorstore): publication initiale (operation import + variantes + images)"
```

### Task 2.11 : Créer `lib/ankorstore-description.ts`

**Files:**
- Create: `lib/ankorstore-description.ts`

- [ ] **Step 1 : Helper de formatage**

```ts
import type { Product, ProductComposition, Composition } from "@prisma/client";

export function formatAnkorstoreDescription(input: {
  description: string;
  reference: string;
  compositions?: { percentage: number | { toString(): string }; composition: { nameFR: string } }[];
}): string {
  const lines: string[] = [];
  // Ankorstore exige min 30 caractères
  const base = input.description?.trim() || "Produit de notre boutique.";
  lines.push(base);
  if (input.compositions && input.compositions.length > 0) {
    const compoStr = input.compositions
      .map((c) => `${Number(c.percentage)}% ${c.composition.nameFR}`)
      .join(", ");
    lines.push(`\nComposition : ${compoStr}`);
  }
  lines.push(`\nRéférence : ${input.reference}`);
  const out = lines.join("\n");
  return out.length >= 30 ? out : `${out}\n\nFiche produit complète sur la boutique.`;
}
```

- [ ] **Step 2 : Test associé**

`__tests__/lib/ankorstore-description.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { formatAnkorstoreDescription } from "@/lib/ankorstore-description";

it("ajoute composition et référence en bas", () => {
  const out = formatAnkorstoreDescription({
    description: "Belle bague en argent.",
    reference: "BAG001",
    compositions: [{ percentage: 92.5, composition: { nameFR: "Argent 925" } }],
  });
  expect(out).toContain("Belle bague en argent.");
  expect(out).toContain("Composition : 92.5% Argent 925");
  expect(out).toContain("Référence : BAG001");
});

it("description vide → placeholder + min 30 chars", () => {
  const out = formatAnkorstoreDescription({ description: "", reference: "X" });
  expect(out.length).toBeGreaterThanOrEqual(30);
});
```

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-description.ts __tests__/lib/ankorstore-description.test.ts
git commit -m "feat(ankorstore): formatage description (composition + ref) + tests"
```

### Task 2.12 : Créer `lib/ankorstore-update.ts`

**Files:**
- Create: `lib/ankorstore-update.ts`

Calque exact de `lib/pfs-update.ts:478-961` (`pfsUpdateProductInPlace`). Structure :

1. Charger le produit (`loadProductFull` identique mais lit `ankorsProductId`/`ankorsLastSyncSnapshot`/`ankorsVariantId`)
2. Construire `nextSnapshot: AnkorstoreSyncSnapshot`
3. Lire `prevSnapshot` (sauf si `forceFullSync` → null)
4. `committedSnapshot = realPrevSnapshot ?? scaffoldEmpty()`
5. `diff = diffAnkorstoreSnapshots(prevSnapshot, nextSnapshot)`
6. Si `diffIsEmpty(diff)` ET pas de variantes à créer → return success
7. Si `diff.productChanged` → batch update via operation type=`update` (champs produit uniquement)
8. Pour chaque variante avec `ankorsVariantId` listée dans `diff.variantsChanged` → `ankorstorePatchVariantStock` + `ankorstorePatchVariantPrices` (endpoints unitaires plus rapides que opération bulk pour quelques variantes)
9. Pour chaque variante locale sans `ankorsVariantId` → operation type=`update` avec ajout variante (Ankorstore permet d'ajouter des variantes via mise à jour ?). Sinon, fallback sur opération `import` pour les nouvelles variantes uniquement.
10. Pour chaque variante côté Ankorstore plus présente localement → soft-delete via PATCH `is_active: false` (Ankorstore n'a pas d'endpoint delete-variant clair — vérifier dans la doc)
11. Images : `for (delete) { ankorstoreDeleteImage(ankorsProductId, slot, color) }` puis `for (upload) { ankorstoreUploadImage }`
12. Statut : si changé → operation type=`update` avec `active: bool`
13. Sauvegarder `committedSnapshot` en BDD

- [ ] **Step 1 : Écrire**

Référence : `lib/pfs-update.ts` à copier pour la structure, adapter les appels.

- [ ] **Step 2 : Tester via `__tests__/lib/ankorstore-update.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { ankorstoreUpdateProductInPlace } from "@/lib/ankorstore-update";

vi.mock("@/lib/prisma", () => ({ prisma: { /* findUnique, update, $transaction */ } }));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstorePatchVariantStock: vi.fn(),
  ankorstorePatchVariantPrices: vi.fn(),
  /* ... */
}));

it("snapshot identique → ne fait aucun appel API", async () => {
  // Mock prisma : produit avec snapshot identique au state cible
  const result = await ankorstoreUpdateProductInPlace("prod1");
  expect(result).toEqual({ success: true, archived: false });
  // Aucun mock API n'a été appelé
});

it("seul le stock change → seul patchVariantStock est appelé", async () => {
  // ...
});

it("forceFullSync → ignore prevSnapshot", async () => {
  // ...
});
```

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-update.ts __tests__/lib/ankorstore-update.test.ts
git commit -m "feat(ankorstore): update incrémental basé sur snapshot diff + tests"
```

### Task 2.13 : Créer `lib/ankorstore-refresh.ts`

**Files:**
- Create: `lib/ankorstore-refresh.ts`

Calque de `lib/pfs-refresh.ts:335-897`. Différences :
- Pas de `pfsCheckReference` → on appelle `ankorstoreSearchProducts(reference)` pour vérifier l'existence
- Pas de "rename" puis "swap" : sur Ankorstore on **archive** l'ancien (`active: false` + `archived: true`) puis on en crée un nouveau avec la même référence (Ankorstore n'a pas de contrainte d'unicité sur `external_id` ? à vérifier dans la doc — sinon, ajouter un suffixe `-archived-{stamp}` à l'`external_id` de l'ancien).
- Rollback symétrique en cas d'échec mi-parcours

- [ ] **Step 1 : Écrire**

- [ ] **Step 2 : Test `__tests__/lib/ankorstore-refresh.test.ts`**

Scénarios :
- Création + archivage ancien OK → nouveau `ankorsProductId` enregistré, snapshot reset
- Échec après création nouveau → rollback (delete nouveau, restaure ancien à `active: true`)
- Échec avant création nouveau → ancien intact, snapshot intact

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-refresh.ts __tests__/lib/ankorstore-refresh.test.ts
git commit -m "feat(ankorstore): refresh complet (création nouveau + archivage ancien + rollback)"
```

### Task 2.14 : Test `__tests__/lib/ankorstore-push-products.test.ts`

**Files:**
- Create: `__tests__/lib/ankorstore-push-products.test.ts`

Vérifie le format JSON envoyé à `ankorstoreAddProductsToOperation`. Cas couverts :
- Variante UNIT mono-couleur → 1 entrée `{ sku, options: [{name:"color", value:"Rouge"}, {name:"size", value:"M"}] }`
- Variante PACK mono-couleur → 1 entrée avec `unit_multiplier = packQuantity`
- Variante PACK multi-couleurs → 1 entrée par couleur de pack ? **À clarifier dans la doc Ankorstore** — si Ankorstore ne supporte pas directement, on aplatit le pack en 1 variante avec `options: [{name:"color", value:"Rouge/Bleu"}]`
- `made_in_country = "CN"` quand `manufacturingCountry.isoCode = "CN"`
- `wholesalePrice` et `retailPrice` en EUR avec marges appliquées

- [ ] **Step 1 : Écrire les tests** (mock du fetch comme dans Task 2.9, vérifier le body JSON envoyé)
- [ ] **Step 2 : Lancer + commit**

```bash
npm test -- __tests__/lib/ankorstore-push-products.test.ts
git add __tests__/lib/ankorstore-push-products.test.ts
git commit -m "test(ankorstore): format JSON envoyé pour UNIT, PACK mono et multi-couleurs"
```

### Task 2.15 : Validation Phase 2

```bash
npm test -- __tests__/lib/ankorstore-
```

Attendu : tous les tests Ankorstore verts (pricing + sync-diff + delete-retry + description + push-products + refresh + update).

```bash
npx tsc --noEmit
```

Attendu : 0 erreur.

---

## Phase 3 — Renommage file partagée (`PfsRefreshContext` → `MarketplaceRefreshContext`)

PFS doit continuer à fonctionner identiquement après cette phase. Aucune logique métier ajoutée — uniquement renommage + ajout d'un champ `marketplace`.

### Task 3.1 : Renommer le contexte

**Files:**
- Rename: `components/admin/products/PfsRefreshContext.tsx` → `MarketplaceRefreshContext.tsx`
- Modify: `components/admin/products/MarketplaceRefreshContext.tsx`

- [ ] **Step 1 : Renommer le fichier**

```bash
git mv components/admin/products/PfsRefreshContext.tsx components/admin/products/MarketplaceRefreshContext.tsx
```

- [ ] **Step 2 : Renommer les exports + ajouter le champ `marketplace`**

Dans le nouveau fichier, faire ces changements :

```ts
// Renommer toutes les occurrences :
//   PfsRefreshContext → MarketplaceRefreshContext
//   PfsRefreshProvider → MarketplaceRefreshProvider
//   PfsRefreshItem → MarketplaceRefreshItem
//   PfsRefreshEnqueueInput → MarketplaceRefreshEnqueueInput
//   usePfsRefreshQueue → useMarketplaceRefreshQueue

// Ajouter dans MarketplaceRefreshItem (et dans EnqueueInput) :
marketplace: "pfs" | "ankorstore";

// Ajouter dans TargetOutcome (déjà générique, OK)
// Ajouter le champ ankorsOutcome :
ankorsOutcome?: TargetOutcome;
```

- [ ] **Step 3 : Adapter `outcomesFromServer` et `outcomesFromPublishServer`**

Lire l'`outcome` reçu de l'API et placer dans `pfsOutcome` OU `ankorsOutcome` selon `item.marketplace`. Pour PFS l'API renvoie déjà `outcome.pfs`. Pour Ankorstore on aura `outcome.ankorstore` (type symétrique).

```ts
function outcomesFromPublishServer(outcome: MarketplacePublishOutcome, marketplace: "pfs" | "ankorstore") {
  if (marketplace === "pfs" && outcome.pfs) {
    return outcome.pfs.status === "ok"
      ? { pfsOutcome: { ok: true, archived: outcome.pfs.archived } }
      : { pfsOutcome: { ok: false, kind: "error", message: outcome.pfs.message } };
  }
  if (marketplace === "ankorstore" && outcome.ankorstore) {
    return outcome.ankorstore.status === "ok"
      ? { ankorsOutcome: { ok: true, archived: outcome.ankorstore.archived } }
      : { ankorsOutcome: { ok: false, kind: "error", message: outcome.ankorstore.message } };
  }
  return {};
}
```

- [ ] **Step 4 : Adapter le routing `endpoint` dans `processItem`**

```ts
const base = item.marketplace === "ankorstore" ? "ankorstore" : "marketplace";
const endpoint =
  item.mode === "publish"  ? `/api/admin/${base}-publish`  :
  item.mode === "resync"   ? `/api/admin/${base}-resync`   :
                              `/api/admin/${base}-refresh`;
```

(PFS reste sur `/api/admin/marketplace-publish` etc. — pas de changement de route. Ankorstore aura ses propres routes `/api/admin/ankorstore-publish`.)

- [ ] **Step 5 : Adapter `hasError`**

```ts
export function hasError(item: MarketplaceRefreshItem): boolean {
  if (item.pfsOutcome && !item.pfsOutcome.ok) return true;
  if (item.ankorsOutcome && !item.ankorsOutcome.ok) return true;
  return false;
}
```

### Task 3.2 : Renommer le widget + afficher Ankorstore

**Files:**
- Rename: `components/admin/products/PfsRefreshWidget.tsx` → `MarketplaceRefreshWidget.tsx`
- Modify: `components/admin/products/MarketplaceRefreshWidget.tsx`

- [ ] **Step 1 : Renommer**

```bash
git mv components/admin/products/PfsRefreshWidget.tsx components/admin/products/MarketplaceRefreshWidget.tsx
```

- [ ] **Step 2 : Renommer la fonction + imports**

```ts
import { useMarketplaceRefreshQueue, hasError, type MarketplaceRefreshItem, type TargetOutcome } from "./MarketplaceRefreshContext";
export function MarketplaceRefreshWidget() { /* ... */ }
```

- [ ] **Step 3 : Étendre l'affichage des badges (ligne 232-249)**

Ajouter à côté du `TargetBadge label="PFS"` un second badge Ankorstore :

```tsx
{item.options.local && <TargetBadge label="Boutique" outcome={item.localOutcome} />}
{item.options.pfs && <TargetBadge label="PFS" outcome={item.pfsOutcome} />}
{item.options.ankorstore && <TargetBadge label="Ankorstore" outcome={item.ankorsOutcome} />}
```

Et même chose pour la ligne d'erreur (252-249) :

```tsx
{item.status === "done" && item.ankorsOutcome && !item.ankorsOutcome.ok && (
  <p className="text-[10px] font-body text-red-600 mt-0.5 truncate" title={item.ankorsOutcome.message}>
    Ankorstore · {item.ankorsOutcome.message}
  </p>
)}
```

### Task 3.3 : Mettre à jour le layout admin

**Files:**
- Modify: `app/(admin)/layout.tsx:12,13,61,87,89`

- [ ] **Step 1 : Imports + JSX**

```diff
-import { PfsRefreshProvider } from "@/components/admin/products/PfsRefreshContext";
-import { PfsRefreshWidget } from "@/components/admin/products/PfsRefreshWidget";
+import { MarketplaceRefreshProvider } from "@/components/admin/products/MarketplaceRefreshContext";
+import { MarketplaceRefreshWidget } from "@/components/admin/products/MarketplaceRefreshWidget";
```

```diff
-    <PfsRefreshProvider>
+    <MarketplaceRefreshProvider>
     <div ...>
       ...
-      <PfsRefreshWidget />
+      <MarketplaceRefreshWidget />
     </div>
-    </PfsRefreshProvider>
+    </MarketplaceRefreshProvider>
```

### Task 3.4 : Mettre à jour les utilisateurs

- [ ] **Step 1 : Trouver tous les imports**

```bash
grep -rn "PfsRefreshContext\|PfsRefreshWidget\|usePfsRefreshQueue\|PfsRefreshProvider\|PfsRefreshItem\|PfsRefreshEnqueueInput" --include="*.tsx" --include="*.ts" .
```

Résultats attendus (à mettre à jour) :
- `components/admin/products/MarketplaceStatusButtons.tsx` (import + usage)
- `components/admin/products/useRefreshMarketplaceDialog.ts` (import + usage)
- Toute liste produits (`app/(admin)/admin/produits/page.tsx`, `components/admin/products/ProductsList*.tsx`) qui utilise `usePfsRefreshQueue`

- [ ] **Step 2 : Remplacer partout**

`PfsRefreshContext` → `MarketplaceRefreshContext`, `usePfsRefreshQueue` → `useMarketplaceRefreshQueue`, etc.

Dans les `enqueue([{ ... }])` ajouter `marketplace: "pfs"` à toutes les entrées existantes (par défaut PFS quand le code n'est pas explicite). Exemples :

```diff
 enqueue([
   {
     productId, reference, productName, firstImage,
     options: { local: false, pfs: true },
     mode: "publish",
+    marketplace: "pfs",
   },
 ]);
```

- [ ] **Step 3 : Compiler + tester non-régression PFS**

```bash
npx tsc --noEmit
npm run dev
```

Aller dans `/admin/produits`, faire un Save sur un produit existant avec PFS coché, vérifier que le widget bas-droite affiche toujours "PFS : ✓" comme avant.

- [ ] **Step 4 : Commit**

```bash
git add -A
git commit -m "refactor(marketplace): renomme PfsRefreshContext en MarketplaceRefreshContext + champ marketplace"
```

---

## Phase 4 — Server actions + routes API Ankorstore

### Task 4.1 : Étendre `marketplace-publish.ts` pour gérer Ankorstore

**Files:**
- Modify: `app/actions/admin/marketplace-publish.ts`

- [ ] **Step 1 : Étendre les types**

```ts
export interface MarketplacePublishOptions {
  pfs: boolean;
  ankorstore: boolean;  // ← nouveau
}

export interface MarketplacePublishOutcome {
  productId: string;
  reference: string;
  productName: string;
  pfs?: { status: "ok"; mode: "create" | "update"; archived?: boolean } | { status: "error"; message: string };
  ankorstore?: { status: "ok"; mode: "create" | "update"; archived?: boolean } | { status: "error"; message: string };
}
```

- [ ] **Step 2 : Charger `ankorsProductId`**

Étendre le `select` de `prisma.product.findUnique` pour inclure `ankorsProductId`.

- [ ] **Step 3 : Branche Ankorstore**

Après le bloc `if (options.pfs)` (lignes 60-99), ajouter un bloc symétrique :

```ts
if (options.ankorstore) {
  try {
    if (product.ankorsProductId) {
      const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
      const res = await ankorstoreUpdateProductInPlace(productId, undefined, { skipRevalidation: true });
      if (res.success) {
        outcome.ankorstore = { status: "ok", mode: "update", archived: res.archived };
      } else {
        logger.warn("[Marketplace Publish] Ankorstore update failed, falling back to publish", { productId, error: res.error });
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsProductId: null, ankorsLastSyncSnapshot: Prisma.DbNull },
        });
        await prisma.productColor.updateMany({
          where: { productId },
          data: { ankorsVariantId: null },
        });
        const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");
        const pubRes = await ankorstorePublishProduct(productId, undefined, { skipRevalidation: true });
        outcome.ankorstore = pubRes.success
          ? { status: "ok", mode: "create", archived: pubRes.archived }
          : { status: "error", message: pubRes.error };
      }
    } else {
      const { ankorstorePublishProduct } = await import("@/lib/ankorstore-publish");
      const res = await ankorstorePublishProduct(productId, undefined, { skipRevalidation: true });
      outcome.ankorstore = res.success
        ? { status: "ok", mode: "create", archived: res.archived }
        : { status: "error", message: res.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Publish] Ankorstore unexpected error", { productId, error: message });
    outcome.ankorstore = { status: "error", message };
  }
}
```

- [ ] **Step 4 : Kill switch**

En tête de la branche `if (options.ankorstore)` :

```ts
const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
const ankorstoreEnabled = await getCachedAnkorstoreEnabled();
if (!ankorstoreEnabled) {
  outcome.ankorstore = { status: "error", message: "Sync Ankorstore désactivée dans Paramètres." };
  // Ne pas exécuter la branche
} else {
  /* code ci-dessus */
}
```

### Task 4.2 : Étendre `marketplace-refresh.ts`

**Files:**
- Modify: `app/actions/admin/marketplace-refresh.ts`

- [ ] **Step 1 : Étendre `MarketplaceRefreshOptions` + `MarketplaceRefreshOutcome`**

```ts
export interface MarketplaceRefreshOptions {
  local: boolean;
  pfs: boolean;
  ankorstore: boolean;
}

export interface MarketplaceRefreshOutcome {
  productId: string;
  reference: string;
  productName: string;
  local: { status: "ok" } | { status: "skipped" };
  pfs?: { status: "ok"; archived: boolean } | { status: "not_found"; message: string } | { status: "error"; message: string };
  ankorstore?: { status: "ok"; archived: boolean } | { status: "not_found"; message: string } | { status: "error"; message: string };
}
```

- [ ] **Step 2 : Branche Ankorstore**

Symétrique à la branche PFS (lignes 67-82) :

```ts
if (options.ankorstore) {
  try {
    const { ankorstoreRefreshProduct } = await import("@/lib/ankorstore-refresh");
    const res = await ankorstoreRefreshProduct(productId, undefined, { skipRevalidation: true });
    if (res.success) {
      outcome.ankorstore = { status: "ok", archived: res.archived };
    } else if (res.reason === "not_found") {
      outcome.ankorstore = { status: "not_found", message: res.error };
    } else {
      outcome.ankorstore = { status: "error", message: res.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Marketplace Refresh] Ankorstore unexpected error", { productId, error: message });
    outcome.ankorstore = { status: "error", message };
  }
}
```

### Task 4.3 : Créer `app/actions/admin/marketplace-resync.ts` Ankorstore

**Files:**
- Modify: `app/actions/admin/marketplace-resync.ts`

- [ ] **Step 1 : Ajouter `resyncProductOnAnkorstore`**

Calque de `resyncProductOnPfs:19-80` :

```ts
export async function resyncProductOnAnkorstore(productId: string): Promise<MarketplacePublishOutcome> {
  await requireAdmin();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, reference: true, name: true, status: true, ankorsProductId: true },
  });
  if (!product) throw new Error("Produit introuvable.");
  const outcome: MarketplacePublishOutcome = { productId, reference: product.reference, productName: product.name };
  if (!product.ankorsProductId) {
    outcome.ankorstore = { status: "error", message: "Produit non publié sur Ankorstore." };
    return outcome;
  }
  try {
    const { ankorstoreUpdateProductInPlace } = await import("@/lib/ankorstore-update");
    const res = await ankorstoreUpdateProductInPlace(productId, undefined, { skipRevalidation: true, forceFullSync: true });
    outcome.ankorstore = res.success
      ? { status: "ok", mode: "update", archived: res.archived }
      : { status: "error", message: res.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Resync] unexpected error", { productId, error: message });
    outcome.ankorstore = { status: "error", message };
  }
  // revalidatePath / emitProductEvent identique au resync PFS
  return outcome;
}
```

### Task 4.4 : Créer les 3 routes API Ankorstore

**Files:**
- Create: `app/api/admin/ankorstore-publish/route.ts`
- Create: `app/api/admin/ankorstore-refresh/route.ts`
- Create: `app/api/admin/ankorstore-resync/route.ts`

- [ ] **Step 1 : `ankorstore-publish/route.ts`**

Calque de `app/api/admin/marketplace-publish/route.ts` mais l'options est forcée à `{ pfs: false, ankorstore: true }` :

```ts
"use server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { publishProductToMarketplaces, type MarketplacePublishOutcome } from "@/app/actions/admin/marketplace-publish";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: "productId requis." }, { status: 400 });
  try {
    const outcome: MarketplacePublishOutcome = await publishProductToMarketplaces(productId, { pfs: false, ankorstore: true });
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2 : `ankorstore-refresh/route.ts`**

Identique mais appelle `refreshProductOnMarketplaces(productId, { local: false, pfs: false, ankorstore: true })`.

- [ ] **Step 3 : `ankorstore-resync/route.ts`**

Calque de `marketplace-resync/route.ts` mais appelle `resyncProductOnAnkorstore(productId)`.

- [ ] **Step 4 : Compiler**

```bash
npx tsc --noEmit
```

- [ ] **Step 5 : Commit**

```bash
git add app/actions/admin/marketplace-*.ts app/api/admin/ankorstore-*
git commit -m "feat(ankorstore): server actions + routes API publish/refresh/resync"
```

### Task 4.5 : Server actions matching

**Files:**
- Create: `app/actions/admin/ankorstore.ts`

Fonctions :
- `runAnkorstoreAutoMatch()` — pour tous les produits sans `ankorsProductId`, appelle `ankorstoreFindVariantBySku` ou `ankorstoreSearchProducts(reference)` puis `runAutoMatch()` du module match. Retourne `{ matched, ambiguous, unmatched, results }`.
- `confirmAnkorstoreMatch(productId, ankorstoreProductId, variantMatches: { localVariantId, ankorstoreVariantId }[])` — remplit `ankorsProductId` + `ankorsVariantId` par couleur **+ initialise `ankorsLastSyncSnapshot` au snapshot calculé pour l'état actuel** (cf. spec § "Initialisation du snapshot"). Pas d'appel API d'écriture.
- `removeAnkorstoreMatch(productId)` — efface `ankorsProductId`/`ankorsLastSyncSnapshot`/`ankorsVariantId` (sans toucher à Ankorstore).
- `linkAnkorstoreProductManually(productId, ankorstoreProductId)` — recherche les variantes du produit Ankorstore puis appelle `confirmAnkorstoreMatch` avec le mapping color.

- [ ] **Step 1 : Écrire**

`requireAdmin()` au début. Pour `confirmAnkorstoreMatch`, le calcul du snapshot initial doit utiliser **les mêmes helpers** que `ankorstorePublishProduct` (extraire dans `lib/ankorstore-snapshot.ts` les builders `buildProductFieldsSnapshot`/`buildVariantSnapshot`/`buildImagesSnapshot` puis les utiliser depuis publish/update/match-confirm).

- [ ] **Step 2 : Refactor : extraire les builders snapshot**

Créer `lib/ankorstore-snapshot.ts` qui exporte :
- `buildAnkorstoreProductFieldsSnapshot(product, brandName, vatRate)`
- `buildAnkorstoreVariantSnapshot(variant, pricing)`
- `buildAnkorstoreImagesSnapshot(product, colorMap)`

Utiliser ces 3 fonctions depuis `lib/ankorstore-publish.ts`, `lib/ankorstore-update.ts`, et `app/actions/admin/ankorstore.ts:confirmAnkorstoreMatch`.

- [ ] **Step 3 : Commit**

```bash
git add lib/ankorstore-snapshot.ts app/actions/admin/ankorstore.ts
git commit -m "feat(ankorstore): server actions matching (auto-match + confirm + link manuel)"
```

---

## Phase 5 — UI : modale, badges, sidebar

### Task 5.1 : Étendre `useRefreshMarketplaceDialog`

**Files:**
- Modify: `components/admin/products/useRefreshMarketplaceDialog.ts`

- [ ] **Step 1 : Étendre `MarketplaceRefreshOptions`** (déjà fait Task 4.2 — l'option `ankorstore` existe).

- [ ] **Step 2 : Ajouter une 3e checkbox dans la modale**

```tsx
checkboxes: [
  { id: "local", label: "Remettre en Nouveauté sur la boutique", defaultChecked: true, onChange: (v) => { localRef.current = v; } },
  { id: "pfs",   label: "Rafraîchir sur Paris Fashion Shop (crée le nouveau, supprime l'ancien)", defaultChecked: false, onChange: (v) => { pfsRef.current = v; } },
  { id: "ankorstore", label: "Rafraîchir sur Ankorstore (crée le nouveau, archive l'ancien)", defaultChecked: false, onChange: (v) => { ankorstoreRef.current = v; } },
],
```

- [ ] **Step 3 : Étendre les options retournées**

```ts
const options: MarketplaceRefreshOptions = {
  local: localRef.current,
  pfs: pfsRef.current,
  ankorstore: ankorstoreRef.current,
};
if (!options.local && !options.pfs && !options.ankorstore) {
  toast.error("Aucune option sélectionnée.");
  return null;
}
```

- [ ] **Step 4 : Adapter le `enqueue([])` pour produire 1 entrée par marketplace ciblée**

```ts
const inputs: MarketplaceRefreshEnqueueInput[] = [];
if (options.pfs) {
  inputs.push({ productId, reference, productName, firstImage, options, mode: "refresh", marketplace: "pfs" });
}
if (options.ankorstore) {
  inputs.push({ productId, reference, productName, firstImage, options, mode: "refresh", marketplace: "ankorstore" });
}
enqueue(inputs);
```

(La file séquence par produit pour ne pas saturer les 2 API en même temps. PFS et Ankorstore tournent en parallèle si la concurrence du provider le permet.)

### Task 5.2 : Étendre `MarketplaceStatusButtons`

**Files:**
- Modify: `components/admin/products/MarketplaceStatusButtons.tsx`

- [ ] **Step 1 : Étendre les props**

```ts
interface MarketplaceStatusButtonsProps {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  pfsProductId: string | null;
  hasPfsConfig: boolean;
  ankorsProductId: string | null;     // ← nouveau
  hasAnkorstoreConfig: boolean;       // ← nouveau
  ankorstoreEnabled: boolean;         // ← nouveau (pour griser)
}
```

- [ ] **Step 2 : Dupliquer le bouton + le bouton resync pour Ankorstore**

Juste après le bloc PFS (lignes 60-106), ajouter un bloc symétrique avec :
- Bouton vert "Ankorstore" si `ankorsProductId`
- Bouton rouge "Non publié Ankorstore" sinon (clic → modale "Publier sur Ankorstore ?")
- Icône ↻ resync à côté du bouton vert

- [ ] **Step 3 : Modale "Publier sur Ankorstore"**

Calque exact de la modale `confirmOpen` (lignes 109-149). Au clic Oui → `enqueue([{ ..., options: { local: false, pfs: false, ankorstore: true }, mode: "publish", marketplace: "ankorstore" }])`.

- [ ] **Step 4 : Modale resync Ankorstore**

Calque de la modale resync PFS (lignes 151-193).

- [ ] **Step 5 : Bouton "Lier à un produit existant"**

Quand `!ankorsProductId && hasAnkorstoreConfig && ankorstoreEnabled`, afficher un petit bouton à côté de "Non publié Ankorstore" avec une icône lien (`<svg>` chaîne). Au clic → ouvre `<LinkAnkorstoreProductModal>` (Task 5.3).

### Task 5.3 : Modale "Lier à un produit existant Ankorstore"

**Files:**
- Create: `components/admin/products/LinkAnkorstoreProductModal.tsx`

- [ ] **Step 1 : Composant `"use client"` avec :**
- Champ de recherche `<input>` qui debounce 300ms et appelle `/api/admin/ankorstore-search?q=...`
- Liste de candidats : nom + ref extraite + nb variantes
- Au clic sur un candidat → confirmation modale "Lier ce produit ?" → server action `linkAnkorstoreProductManually(productId, ankorstoreProductId)` → toast + close

- [ ] **Step 2 : Créer la route API recherche**

`app/api/admin/ankorstore-search/route.ts` qui appelle `ankorstoreSearchProducts(query)` (read seulement, déjà dans `lib/ankorstore-api.ts`).

- [ ] **Step 3 : Commit**

```bash
git add components/admin/products/MarketplaceStatusButtons.tsx components/admin/products/LinkAnkorstoreProductModal.tsx app/api/admin/ankorstore-search/route.ts components/admin/products/useRefreshMarketplaceDialog.ts
git commit -m "feat(ankorstore): badges + modales fiche produit + liaison à un existant"
```

### Task 5.4 : Modale "Enregistrer" du formulaire produit

**Files:**
- Modify: `components/admin/products/ProductForm*.tsx` (le composant qui contient le bouton "Enregistrer")

- [ ] **Step 1 : Identifier le composant**

```bash
grep -rn "Publier sur marketplace\|publishProductToMarketplaces\|hasPfsConfig" components/admin/products/ --include="*.tsx"
```

- [ ] **Step 2 : Ajouter une 2e checkbox**

La modale qui apparaît au save (probablement un `useConfirm()` avec checkboxes ou un composant dédié) doit afficher :

- ☐ Publier sur **Paris Fashion Shop** (si `hasPfsConfig`)
- ☐ Publier sur **Ankorstore** (si `hasAnkorstoreConfig && ankorstoreEnabled`)

Au submit, `enqueue` 1 entrée par case cochée :

```ts
const inputs: MarketplaceRefreshEnqueueInput[] = [];
if (pfsChecked) inputs.push({ ..., marketplace: "pfs", mode: "publish" });
if (ankorstoreChecked) inputs.push({ ..., marketplace: "ankorstore", mode: "publish" });
enqueue(inputs);
```

- [ ] **Step 3 : Charger `hasAnkorstoreConfig` côté server component du formulaire**

Dans la page `app/(admin)/admin/produits/[id]/modifier/page.tsx` (ou équivalent création), ajouter aux props passées au form :

```ts
const [hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled] = await Promise.all([
  getCachedHasPfsConfig(),
  getCachedHasAnkorstoreConfig(),
  getCachedAnkorstoreEnabled(),
]);
```

- [ ] **Step 4 : Commit**

```bash
git add -A
git commit -m "feat(ankorstore): modale 'Enregistrer' avec case Ankorstore en plus de PFS"
```

### Task 5.5 : Liste produits `/admin/produits` — badge Ankorstore

**Files:**
- Modify: `app/(admin)/admin/produits/page.tsx` (chargement données)
- Modify: `components/admin/products/ProductsTable.tsx` ou équivalent (rendu colonne)

- [ ] **Step 1 : Charger `ankorsProductId` dans la query** (déjà accessible via `select`).

- [ ] **Step 2 : Ajouter une colonne Ankorstore dans la table**

À côté de la colonne PFS, ajouter une cellule similaire avec un point vert/gris :

```tsx
<td className="...">
  <span className={`inline-flex items-center gap-1 text-[11px] ${product.ankorsProductId ? "text-green-700" : "text-text-muted"}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${product.ankorsProductId ? "bg-green-500" : "bg-gray-300"}`} />
    Ankorstore
  </span>
</td>
```

- [ ] **Step 3 : Commit**

```bash
git add -A
git commit -m "feat(ankorstore): badge Ankorstore dans la liste /admin/produits"
```

### Task 5.6 : Sidebar admin — entrée Ankorstore

**Files:**
- Modify: `components/admin/AdminDesktopShell.tsx`

- [ ] **Step 1 : Ajouter dans la section "Catalogue"** (après "Catalogues") :

```ts
{ label: "Ankorstore", href: "/admin/ankorstore", icon: "M3.75 3v11.25..." /* icône lien */ },
```

- [ ] **Step 2 : Pareil dans `AdminMobileNav` si présent**

- [ ] **Step 3 : Commit**

```bash
git add -A
git commit -m "feat(ankorstore): entrée sidebar admin"
```

---

## Phase 6 — Page de matching `/admin/ankorstore`

### Task 6.1 : Page server-side

**Files:**
- Create: `app/(admin)/admin/ankorstore/page.tsx`

- [ ] **Step 1 : Squelette**

```tsx
import { prisma } from "@/lib/prisma";
import { getCachedHasAnkorstoreConfig } from "@/lib/cached-data";
import { redirect } from "next/navigation";
import AnkorstoreMatchingClient from "@/components/admin/ankorstore/AnkorstoreMatchingClient";

export const metadata = { title: "Ankorstore — matching" };

export default async function AnkorstorePage() {
  const hasConfig = await getCachedHasAnkorstoreConfig();
  if (!hasConfig) {
    return (
      <div className="p-6">
        <h1 className="font-heading text-2xl font-bold mb-4">Ankorstore</h1>
        <p>Configurez d'abord vos identifiants dans <a href="/admin/parametres" className="underline">Paramètres &gt; Marketplaces</a>.</p>
      </div>
    );
  }
  // Liste produits sans ankorsProductId
  const unlinked = await prisma.product.findMany({
    where: { ankorsProductId: null, status: { not: "ARCHIVED" } },
    select: { id: true, reference: true, name: true, colors: { select: { id: true, color: { select: { name: true } } } } },
    orderBy: { reference: "asc" },
  });
  return <AnkorstoreMatchingClient unlinkedProducts={unlinked} />;
}
```

### Task 6.2 : Composant `AnkorstoreMatchingClient`

**Files:**
- Create: `components/admin/ankorstore/AnkorstoreMatchingClient.tsx`

- [ ] **Step 1 : Skeleton**

```tsx
"use client";
import { useState, useTransition } from "react";
import { runAnkorstoreAutoMatch, confirmAnkorstoreMatch } from "@/app/actions/admin/ankorstore";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface UnlinkedProduct {
  id: string;
  reference: string;
  name: string;
  colors: { id: string; color: { name: string } | null }[];
}

interface MatchSuggestion {
  productId: string;
  reference: string;
  productName: string;
  status: "matched" | "ambiguous" | "unmatched";
  candidate?: {
    ankorstoreProductId: string;
    ankorstoreName: string;
    extractedRef: string | null;
    variantMatches: { localVariantId: string; ankorstoreVariantId: string; bjColorName: string | null; ankorstoreSku: string }[];
  };
}

export default function AnkorstoreMatchingClient({ unlinkedProducts }: { unlinkedProducts: UnlinkedProduct[] }) {
  const [suggestions, setSuggestions] = useState<MatchSuggestion[] | null>(null);
  const [isMatching, startMatching] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  function handleAutoMatch() {
    startMatching(async () => {
      try {
        const report = await runAnkorstoreAutoMatch();
        setSuggestions(report.results);
        toast.success(`${report.matched} matchs trouvés sur ${report.total} produits`);
      } catch (err) {
        toast.error("Échec du matching automatique", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleConfirm(s: MatchSuggestion) {
    if (!s.candidate) return;
    await confirmAnkorstoreMatch(s.productId, s.candidate.ankorstoreProductId, s.candidate.variantMatches);
    setSuggestions((prev) => prev?.filter((x) => x.productId !== s.productId) ?? null);
    toast.success(`${s.reference} lié à Ankorstore`);
  }

  async function handleConfirmAll() {
    if (!suggestions) return;
    const ok = await confirm({ type: "warning", title: "Tout valider ?", message: `${suggestions.filter((s) => s.status === "matched").length} matchs vont être enregistrés. Vous ne pourrez pas les annuler en masse.`, confirmLabel: "Tout valider" });
    if (!ok) return;
    for (const s of suggestions.filter((x) => x.status === "matched")) {
      await handleConfirm(s);
    }
  }

  // ... render : tableau 2 colonnes (produit local | candidat) + boutons Confirmer/Refuser
}
```

- [ ] **Step 2 : Render UI**

Tableau avec :
- Colonne gauche : référence + nom du produit local + miniatures couleurs
- Colonne droite : si `candidate` → nom Ankorstore + extracted ref + nb variantes mappées ; sinon → "Aucun candidat trouvé"
- Actions : "Confirmer" (si matched) / "Refuser" (cache la ligne)
- Bouton header "Tout valider" (uniquement si au moins un `matched`)
- Filtre par statut (matched / ambiguous / unmatched)

- [ ] **Step 3 : Commit**

```bash
git add app/\(admin\)/admin/ankorstore/page.tsx components/admin/ankorstore/AnkorstoreMatchingClient.tsx
git commit -m "feat(ankorstore): page /admin/ankorstore — matching de masse + UI confirmation"
```

---

## Phase 7 — Suppression locale propage à Ankorstore

### Task 7.1 : Étendre `deleteProduct` + `bulkDeleteProducts`

**Files:**
- Modify: `app/actions/admin/products.ts:1037` (`deleteProduct`)
- Modify: `app/actions/admin/products.ts:1277` (`bulkDeleteProducts`)

- [ ] **Step 1 : Lire `ankorsProductId` au début**

Dans `deleteProduct(id)` modifier le `select` pour inclure `ankorsProductId` :

```ts
const product = await prisma.product.findUnique({
  where: { id },
  select: { reference: true, ankorsProductId: true },
});
```

- [ ] **Step 2 : Avant `prisma.product.delete` ou `prisma.product.update`, propager à Ankorstore**

```ts
if (product.ankorsProductId) {
  const { getCachedAnkorstoreEnabled } = await import("@/lib/cached-data");
  const { ankorstoreDeleteProduct } = await import("@/lib/ankorstore-api-write");
  const enabled = await getCachedAnkorstoreEnabled();
  if (enabled) {
    try {
      await ankorstoreDeleteProduct(product.ankorsProductId);
      logger.info("[Ankorstore] Product archived after local delete", { reference: product.reference, ankorsProductId: product.ankorsProductId });
    } catch (err) {
      // Suppression locale toujours effective — log enrichi mais on ne bloque pas
      logger.error("[Ankorstore] Failed to archive after retries", { reference: product.reference, ankorsProductId: product.ankorsProductId, error: err });
    }
  }
}
```

⚠️ **Important** : la suppression locale doit toujours réussir, peu importe l'état Ankorstore. C'est un choix assumé (cf. spec § "Erreurs et garde-fous").

- [ ] **Step 3 : Idem dans `bulkDeleteProducts`**

Avant la boucle de suppression locale, charger les `ankorsProductId` non-null et les archiver en batch (séquentiellement, max 50 par opération Ankorstore) :

```ts
const productsWithAnkors = await prisma.product.findMany({
  where: { id: { in: productIds }, ankorsProductId: { not: null } },
  select: { id: true, reference: true, ankorsProductId: true },
});
if (productsWithAnkors.length > 0) {
  const enabled = await getCachedAnkorstoreEnabled();
  if (enabled) {
    for (const p of productsWithAnkors) {
      try {
        await ankorstoreDeleteProduct(p.ankorsProductId!);
      } catch (err) {
        logger.error("[Ankorstore] Bulk delete archive failed", { reference: p.reference, error: err });
      }
    }
  }
}
```

- [ ] **Step 4 : Commit**

```bash
git add app/actions/admin/products.ts
git commit -m "feat(ankorstore): suppression locale propage automatiquement à Ankorstore"
```

---

## Phase 8 — Validation locale + déploiement

### Task 8.1 : Suite de tests automatisés complète

- [ ] **Step 1 : Tous les tests Ankorstore**

```bash
npm test -- __tests__/lib/ankorstore-
```

Attendu : tous verts (pricing, sync-diff, delete-retry, description, push-products, refresh, update).

- [ ] **Step 2 : Tests d'intégration PFS non-régressés**

```bash
npm test -- __tests__/integration
```

Attendu : aucune régression PFS suite au renommage `MarketplaceRefreshContext`.

- [ ] **Step 3 : Smoke PFS**

```bash
npm run test:pfs-smoke
```

### Task 8.2 : Validation parcours admin (en local)

⚠️ Tester **dans cet ordre précis**, sur la prod Ankorstore (sandbox indispo).

- [ ] **1. Paramètres > Marketplaces** : saisir `client_id` + `client_secret`, cocher Activer, Tester la connexion → ✓ Connecté.
- [ ] **2. Créer un produit test** : `/admin/produits/nouveau`, photos + couleurs + tailles + stock + prix. Cocher Ankorstore au save. Le widget bas-droite doit afficher "Ankorstore : ✓".
- [ ] **3. Vérifier sur ankorstore.com** côté brand backoffice : produit présent, photos OK, prix OK (avec marges appliquées).
- [ ] **4. Update incrémental** : modifier seulement le stock, save coché Ankorstore. Le widget doit terminer rapidement (pas de re-upload images dans les logs `pm2 logs` — chercher `[Ankorstore Update] Images unchanged → skip`).
- [ ] **5. Resync forcé** : icône ↻ sur la fiche produit → confirmer → tout est renvoyé (logs montrent toutes les sections).
- [ ] **6. Refresh complet** : bouton "Rafraîchir" + case Ankorstore. Sur Ankorstore : nouveau produit créé, ancien archivé.
- [ ] **7. Suppression** : supprimer un produit lié → vérifier que côté Ankorstore le produit est archivé (peut prendre quelques secondes, retry actif).
- [ ] **8. Matching** (si vous avez accès à un compte Ankorstore avec des produits préexistants) : `/admin/ankorstore` → "Lancer le matching automatique" → confirmer 2-3 candidats individuellement. Vérifier que `ankorsProductId` est rempli en BDD via `npx prisma studio`.

### Task 8.3 : Déploiement en prod

- [ ] **Step 1 : Sauvegarde DB et uploads** (dump MySQL + tar des `public/uploads`/`private/uploads`).

- [ ] **Step 2 : Push GitHub**

```bash
git push origin master
```

- [ ] **Step 3 : SSH VPS**

```bash
ssh root@72.61.106.128 "cd /var/www/beliandjolie && \
  git fetch origin master && git reset --hard origin/master && \
  npm install --no-audit --no-fund && \
  npx prisma generate && npx prisma db push --skip-generate && \
  NODE_OPTIONS='--max-old-space-size=4096' npm run build && \
  pm2 restart beliandjolie"
```

- [ ] **Step 4 : Vérification "parcours visiteur"**

```bash
curl -sL https://beliandjolie.com/fr/admin/ankorstore -o /dev/null -w "%{http_code}\n"
# Attendu : 307 ou 200 selon login
```

Puis se connecter au backoffice → `/admin/ankorstore` doit s'afficher.

### Task 8.4 : Matching de masse en prod

L'utilisatrice se connecte au backoffice prod et lance le matching auto sur tous ses produits. Confirme les candidats produit par produit. À partir de là, toute modification future part automatiquement chez Ankorstore quand la case est cochée.

---

## Phase 9 — Documentation

### Task 9.1 : Restaurer la section Ankorstore dans `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (section `## Architecture`)

- [ ] **Step 1 : Ajouter une nouvelle section après le bloc PFS (Marketplace publishing via API live)**

Suivre la même structure que la section PFS : objectif, identifiants stockés, modale au save, server action, fichiers clés, diff de sync, resync forcée, delete propagé, marges, helpers cachés. Marquer en haut "actif depuis 2026-05-10".

- [ ] **Step 2 : Mettre à jour la note "Ankorstore en pause"** (en bas du bloc Architecture, ligne ~52) :

Remplacer :
```
- **Note Ankorstore** : intégration en pause (mai 2026) — code et paramètres retirés. Doc API conservée dans `docs/ankorstore-api.md` pour réactivation future.
```

Par :
```
- **Ankorstore** : intégration réactivée 2026-05-10 (cf. section dédiée plus haut). Doc API : `docs/ankorstore-api.md`.
```

- [ ] **Step 3 : Ajouter Ankorstore dans la section "Variables d'environnement"** :

Section "Configurables uniquement via paramètres admin" :
```
- identifiants Ankorstore (client_id + client_secret OAuth2)
```

- [ ] **Step 4 : Commit**

```bash
git add CLAUDE.md
git commit -m "docs: restaure section Ankorstore dans CLAUDE.md (intégration réactivée)"
```

---

## Récapitulatif des fichiers touchés

### Créés (lib + API + UI)
- `lib/ankorstore-auth.ts` (restauré depuis `c68fe7b^`)
- `lib/ankorstore-match.ts` (restauré depuis `a33fcd1^`)
- `lib/ankorstore-api.ts`
- `lib/ankorstore-api-write.ts`
- `lib/ankorstore-pricing.ts`
- `lib/ankorstore-sync-diff.ts`
- `lib/ankorstore-snapshot.ts` (factorisation des builders)
- `lib/ankorstore-publish.ts`
- `lib/ankorstore-update.ts`
- `lib/ankorstore-refresh.ts`
- `lib/ankorstore-description.ts`
- `app/actions/admin/ankorstore.ts`
- `app/api/admin/ankorstore-publish/route.ts`
- `app/api/admin/ankorstore-refresh/route.ts`
- `app/api/admin/ankorstore-resync/route.ts`
- `app/api/admin/ankorstore-search/route.ts`
- `app/(admin)/admin/ankorstore/page.tsx`
- `components/admin/ankorstore/AnkorstoreMatchingClient.tsx`
- `components/admin/products/LinkAnkorstoreProductModal.tsx`

### Tests
- `__tests__/lib/ankorstore-pricing.test.ts`
- `__tests__/lib/ankorstore-sync-diff.test.ts`
- `__tests__/lib/ankorstore-delete-retry.test.ts`
- `__tests__/lib/ankorstore-description.test.ts`
- `__tests__/lib/ankorstore-push-products.test.ts`
- `__tests__/lib/ankorstore-refresh.test.ts`
- `__tests__/lib/ankorstore-update.test.ts`

### Renommés
- `components/admin/products/PfsRefreshContext.tsx` → `MarketplaceRefreshContext.tsx`
- `components/admin/products/PfsRefreshWidget.tsx` → `MarketplaceRefreshWidget.tsx`

### Modifiés
- `prisma/schema.prisma` (Product + ProductColor)
- `lib/encryption.ts` (SENSITIVE_KEYS)
- `lib/cached-data.ts` (3 helpers Ankorstore)
- `app/actions/admin/site-config.ts` (4 server actions Ankorstore)
- `app/actions/admin/marketplace-publish.ts` (branche Ankorstore + types)
- `app/actions/admin/marketplace-refresh.ts` (branche Ankorstore + types)
- `app/actions/admin/marketplace-resync.ts` (`resyncProductOnAnkorstore`)
- `app/actions/admin/products.ts` (`deleteProduct` + `bulkDeleteProducts` propagent à Ankorstore)
- `app/(admin)/layout.tsx` (renommage provider/widget)
- `app/(admin)/admin/parametres/page.tsx` (nouvelles props)
- `app/(admin)/admin/produits/page.tsx` (badge colonne)
- `app/(admin)/admin/produits/[id]/modifier/page.tsx` (props formulaire)
- `components/admin/AdminDesktopShell.tsx` (entrée sidebar)
- `components/admin/AdminMobileNav.tsx` (entrée sidebar mobile)
- `components/admin/settings/MarketplaceConfig.tsx` (carte Ankorstore)
- `components/admin/products/MarketplaceStatusButtons.tsx` (badge + bouton lier + resync Ankorstore)
- `components/admin/products/useRefreshMarketplaceDialog.ts` (3e checkbox)
- `components/admin/products/ProductForm*.tsx` (modale save : 2e checkbox)
- `CLAUDE.md` (section Ankorstore restaurée)

---

## Notes pour l'engineer

- **Commit fréquent** : après chaque sous-tâche cochée, faire un commit. Si une étape plante, on peut revenir au commit précédent.
- **Mocker Prisma + fetch** dans tous les tests `__tests__/lib/ankorstore-*.test.ts` pour éviter de toucher la BDD ou Ankorstore. Les tests d'intégration tournent en série (`fileParallelism: false`) et hitent une vraie BDD test.
- **Logs préfixés `[Ankorstore]`** partout côté serveur (jamais `console.log` — toujours `import { logger } from "@/lib/logger"`).
- **Imports dynamiques** pour les modules Ankorstore dans `marketplace-publish.ts` / `products.ts` afin que le bundle initial reste léger quand Ankorstore est désactivé.
- **Vérification doc API** : 3 points à confirmer dans `docs/ankorstore-api.md` ou via test manuel **avant** d'écrire `lib/ankorstore-publish.ts` :
  1. Comment Ankorstore gère un PACK multi-couleurs (1 variante avec `options.color = "Rouge/Bleu"` ou plusieurs variantes ?)
  2. L'unicité de `external_id` lors d'un refresh (faut-il renommer l'ancien avant de créer le nouveau ?)
  3. Endpoint exact pour delete/archive d'une variante individuelle (`PATCH /product-variants/{id}` avec `archived: true` ? ou pas d'endpoint dédié — il faut passer par operation `update` ?)

  Si la doc ne tranche pas, faire un test manuel dans le sandbox Ankorstore (`POST /api/testing/orders/create`) avant d'engager du code.
