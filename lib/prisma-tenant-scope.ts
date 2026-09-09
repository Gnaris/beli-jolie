/**
 * Extension Prisma « tenant scoping » — filtre automatiquement toutes les
 * requêtes portant sur des modèles multi-tenant avec le `tenantId` du contexte
 * de requête courant (lu via `next/headers`, posé par le middleware).
 *
 * Sans cette extension, il faudrait patcher les ~330 exports server actions
 * un à un pour ajouter `where: { tenantId }`. Avec, le filtre est appliqué
 * globalement et de manière cohérente.
 *
 * Comportement :
 *   - findMany/findFirst/count/aggregate : ajoute `AND: { tenantId }` au where
 *   - create/upsert : injecte `tenantId` dans data
 *   - createMany : injecte `tenantId` dans chaque data
 *   - update/updateMany/delete/deleteMany : filtre par tenantId
 *   - findUnique/findUniqueOrThrow : lookup par clé unique, puis vérifie
 *     que le tenantId correspond (sinon retourne null / lève)
 *   - Nested writes (`create: { children: { create: [...] } }`) : parcours
 *     récursif via `injectTenantIntoNestedWrites` + Prisma DMMF pour injecter
 *     `tenantId` sur chaque enfant tenant-scoped. Sans ça, les nested inserts
 *     génèrent des rows orphelines (tenantId=NULL) invisibles des reads scopés.
 *   - Modèles non-scopés (Color, Category, Size…) : passthrough
 *   - Hors contexte requête (scripts, cron) : passthrough (aucun filtrage)
 *
 * IMPORTANT : les scripts CLI (`npx tsx scripts/...`) tournent sans headers,
 * ils voient TOUS les tenants. C'est voulu — un backfill ou une opération
 * de maintenance doit pouvoir traverser les boutiques.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

/**
 * Client "raw" utilisé uniquement pour les pré-checks à l'intérieur de
 * l'extension (update/delete/upsert). Ne passe PAS par l'extension elle-même
 * — sinon récursion infinie. Un seul pool de connexions global pour éviter
 * la duplication mémoire.
 */
const preCheckClient = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  log: [],
});

/** Liste des modèles qui portent un tenantId (voir prisma/schema.prisma). */
export const TENANT_SCOPED_MODELS = new Set<string>([
  "User",
  "Product",
  "Order",
  "CompanyInfo",
  "SiteConfig",
  "ProductTranslation",
  "ProductColor",
  "ProductColorImage",
  "ProductSimilar",
  "ProductBundle",
  "ProductTag",
  "ProductComposition",
  "ProductView",
  "PriceHistory",
  "Cart",
  "CartItem",
  "Visit",
  "PendingSimilar",
  "OrderItem",
  "OrderItemModification",
  "Favorite",
  "ShippingAddress",
  "Claim",
  "ClaimItem",
  "ClaimImage",
  "ClaimReturn",
  "ClaimReship",
  "Credit",
  "CreditUsage",
  "Collection",
  "CollectionTranslation",
  "CollectionProduct",
  "CollectionRule",
  "CollectionExclusion",
  "Promotion",
  "PromotionCategory",
  "PromotionCollection",
  "PromotionProduct",
  "PromotionUsage",
  "Catalog",
  "CatalogProduct",
  "ImportJob",
  "ImportDraft",
  "AnkorstoreOperation",
  "MarketplaceRefreshJob",
  "EfashionShootingBatchItem",
  "ImageProcessingJob",
  "MicrostoreUploadJob",
  "TranslationJob",
  "StockMovement",
  "LegalDocument",
  "LegalDocumentVersion",
  "Conversation",
  "Message",
  "MessageAttachment",
  "PasswordResetToken",
  "LoginOtp",
  "LoginAttempt",
  "AccountLockout",
  "RegistrationLog",
  "TranslationQuota",
  "StripeWebhookEvent",
  "VariantSize",
  "PackColorLine",
  "PackColorLineSize",
  // Shared libs isolées par tenant depuis 2026-07-12
  "Category",
  "SubCategory",
  "Color",
  "Size",
  "Composition",
  "Season",
  "ManufacturingCountry",
  "Tag",
]);

/**
 * Résout le tenant courant depuis les headers de requête. Retourne `null`
 * si on est hors contexte requête (scripts, cron, boot) — le caller doit
 * alors sauter le filtrage.
 */
async function getTenantIdFromRequest(): Promise<string | null> {
  // Priorité à l'ALS Node : peuplée par lib/tenant.ts::getCurrentTenant/etc,
  // elle survit aux microtasks où next/headers throw.
  const fromALS = getCurrentTenantIdSync();
  if (fromALS) return fromALS;

  // Fallback : lecture directe des headers. Fonctionne pour les tout premiers
  // appels d'un handler qui n'a pas encore appelé getCurrentTenant().
  try {
    const h = await headers();
    return h.get("x-tenant-id");
  } catch {
    return null;
  }
}

type QueryArgs = { where?: unknown; data?: unknown };
type QueryFn<T = unknown> = (args: QueryArgs) => Promise<T>;

/**
 * Récupère le delegate Prisma pour un modèle donné sur le client raw. Utilisé
 * uniquement par les pré-checks update/delete/upsert. `null` si le modèle
 * n'existe pas (ne devrait pas arriver — TENANT_SCOPED_MODELS est fermé).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPreCheckModelDelegate(model: string): any {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (preCheckClient as any)[key] ?? null;
}

function mergeWhere(where: unknown, tenantFilter: { tenantId: string }): unknown {
  if (!where || typeof where !== "object" || Object.keys(where as object).length === 0) {
    return tenantFilter;
  }
  return { AND: [where, tenantFilter] };
}

// ─────────────────────────────────────────────────────────────────────────
// Injection récursive de `tenantId` dans les nested writes.
//
// Le hook Prisma `$allOperations` n'est déclenché que sur l'opération racine.
// Un `prisma.order.create({ data: { items: { create: [...] } } })` passe bien
// dans le case "create" pour Order (tenantId injecté), mais les OrderItem
// insérés en cascade ne repassent PAS par l'extension → tenantId reste NULL
// en base, l'item devient invisible pour toute query scopée par la suite.
//
// On règle ça en parcourant récursivement l'arg avant d'appeler `query()`,
// et en posant `tenantId` sur chaque nested `create` / `createMany` /
// `connectOrCreate.create` / `upsert.create` qui vise un modèle tenant-scoped.
// On descend aussi dans `update` / `upsert.update` pour couvrir les nested
// creates emboîtés (ex: `parent.update({ data: { child: { create: [...] } } })`).
// ─────────────────────────────────────────────────────────────────────────

interface DmmfField {
  name: string;
  kind: string;
  type: string;
  relationName?: string;
}

interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

// Mapping model → { relationFieldName → childModelName }, construit une seule
// fois au chargement du module depuis Prisma.dmmf.
const NESTED_RELATIONS: Record<string, Record<string, string>> = (() => {
  const out: Record<string, Record<string, string>> = {};
  // Prisma.dmmf existe au runtime en Prisma 5.x mais n'est pas type-exposé.
  const dmmf = (Prisma as unknown as { dmmf?: { datamodel?: { models?: DmmfModel[] } } }).dmmf;
  const models = dmmf?.datamodel?.models ?? [];
  for (const m of models) {
    const rels: Record<string, string> = {};
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationName) {
        rels[f.name] = f.type;
      }
    }
    out[m.name] = rels;
  }
  return out;
})();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parcourt `data` (payload d'un create/update/upsert) et injecte `tenantId`
 * sur tous les nested writes ciblant un modèle tenant-scoped.
 * `parentModel` = modèle du niveau courant (nécessaire pour retrouver ses
 * relations dans NESTED_RELATIONS).
 */
export function injectTenantIntoNestedWrites(
  parentModel: string,
  data: unknown,
  tenantId: string,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!isPlainObject(data)) return;
  if (seen.has(data)) return;
  seen.add(data);

  const rels = NESTED_RELATIONS[parentModel];
  if (!rels) return;

  for (const [fieldName, childModel] of Object.entries(rels)) {
    const nested = data[fieldName];
    if (!isPlainObject(nested)) continue;

    const isTenantChild = TENANT_SCOPED_MODELS.has(childModel);

    // ── create : { create: {...} } ou { create: [...] } ──
    if ("create" in nested) {
      const createNode = nested.create;
      if (Array.isArray(createNode)) {
        for (const item of createNode) {
          if (!isPlainObject(item)) continue;
          if (isTenantChild && item.tenantId === undefined) item.tenantId = tenantId;
          injectTenantIntoNestedWrites(childModel, item, tenantId, seen);
        }
      } else if (isPlainObject(createNode)) {
        if (isTenantChild && createNode.tenantId === undefined) createNode.tenantId = tenantId;
        injectTenantIntoNestedWrites(childModel, createNode, tenantId, seen);
      }
    }

    // ── createMany : { createMany: { data: [...] } } (pas de nested à l'intérieur) ──
    if ("createMany" in nested && isPlainObject(nested.createMany)) {
      const cmData = (nested.createMany as { data?: unknown }).data;
      if (Array.isArray(cmData)) {
        for (const item of cmData) {
          if (isPlainObject(item) && isTenantChild && item.tenantId === undefined) {
            item.tenantId = tenantId;
          }
        }
      } else if (isPlainObject(cmData) && isTenantChild && cmData.tenantId === undefined) {
        cmData.tenantId = tenantId;
      }
    }

    // ── connectOrCreate : { connectOrCreate: { where, create } } ou tableau ──
    if ("connectOrCreate" in nested) {
      const coc = nested.connectOrCreate;
      const arr = Array.isArray(coc) ? coc : isPlainObject(coc) ? [coc] : [];
      for (const item of arr) {
        if (!isPlainObject(item) || !isPlainObject(item.create)) continue;
        if (isTenantChild && item.create.tenantId === undefined) item.create.tenantId = tenantId;
        injectTenantIntoNestedWrites(childModel, item.create, tenantId, seen);
      }
    }

    // ── upsert : { upsert: { where, create, update } } ou tableau ──
    if ("upsert" in nested) {
      const up = nested.upsert;
      const arr = Array.isArray(up) ? up : isPlainObject(up) ? [up] : [];
      for (const item of arr) {
        if (!isPlainObject(item)) continue;
        if (isPlainObject(item.create)) {
          if (isTenantChild && item.create.tenantId === undefined) item.create.tenantId = tenantId;
          injectTenantIntoNestedWrites(childModel, item.create, tenantId, seen);
        }
        if (isPlainObject(item.update)) {
          injectTenantIntoNestedWrites(childModel, item.update, tenantId, seen);
        }
      }
    }

    // ── update : { update: { where, data } } ou { update: {...} } (1-to-1) ou tableau ──
    if ("update" in nested) {
      const upd = nested.update;
      const arr = Array.isArray(upd) ? upd : isPlainObject(upd) ? [upd] : [];
      for (const item of arr) {
        if (!isPlainObject(item)) continue;
        if (isPlainObject(item.data)) {
          injectTenantIntoNestedWrites(childModel, item.data, tenantId, seen);
        } else {
          injectTenantIntoNestedWrites(childModel, item, tenantId, seen);
        }
      }
    }

    // ── updateMany : { updateMany: { where, data } } ou tableau ──
    if ("updateMany" in nested) {
      const um = nested.updateMany;
      const arr = Array.isArray(um) ? um : isPlainObject(um) ? [um] : [];
      for (const item of arr) {
        if (isPlainObject(item) && isPlainObject(item.data)) {
          injectTenantIntoNestedWrites(childModel, item.data, tenantId, seen);
        }
      }
    }
  }
}

/**
 * Extension Prisma qui applique le scoping tenant. À composer avec la
 * extension health-monitoring dans `lib/prisma.ts`.
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: "tenantScope",
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations(this: unknown, { model, operation, args, query }: any) {
        const tenantId = await getTenantIdFromRequest();
        if (!tenantId) {
          return query(args);
        }

        // Nested-write injection : parcourt l'arg AVANT que Prisma ne l'exécute.
        // Doit tourner MÊME si le parent n'est pas tenant-scoped (rare mais
        // possible qu'un parent hors-scope contienne un nested create scoped).
        if (
          operation === "create" ||
          operation === "update" ||
          operation === "updateMany"
        ) {
          injectTenantIntoNestedWrites(model, args?.data, tenantId);
        } else if (operation === "upsert") {
          injectTenantIntoNestedWrites(model, args?.create, tenantId);
          injectTenantIntoNestedWrites(model, args?.update, tenantId);
        }

        if (!TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        switch (operation) {
          case "findMany":
          case "findFirst":
          case "findFirstOrThrow":
          case "count":
          case "aggregate":
          case "groupBy": {
            args.where = mergeWhere(args.where, { tenantId });
            return query(args);
          }
          case "updateMany":
          case "deleteMany": {
            args.where = mergeWhere(args.where, { tenantId });
            return query(args);
          }
          case "update":
          case "delete": {
            // PRÉ-CHECK : la row existe-t-elle dans le tenant courant ?
            // Sans ce check, on exécuterait le SQL UPDATE/DELETE avant de
            // détecter le mismatch tenant → corruption des données de l'autre
            // tenant persistée en BDD avant que l'erreur remonte.
            args.where = args.where ?? {};
            const modelDelegate = getPreCheckModelDelegate(model);
            if (modelDelegate) {
              const existing = await modelDelegate.findUnique({
                where: args.where,
                select: { tenantId: true },
              });
              if (existing && existing.tenantId && existing.tenantId !== tenantId) {
                throw new Error(
                  `Tentative de ${operation} sur ${model} hors du tenant courant (${tenantId} attendu, ${existing.tenantId} trouvé).`
                );
              }
            }
            return query(args);
          }
          case "upsert": {
            // PRÉ-CHECK identique à update, PLUS injection de tenantId dans
            // la branche create (bug identifié par l'agent : upsert ne passait
            // jamais par le case "create", donc les rows créées étaient
            // orphelines et visibles depuis tous les tenants).
            args.where = args.where ?? {};
            const modelDelegate = getPreCheckModelDelegate(model);
            if (modelDelegate) {
              const existing = await modelDelegate.findUnique({
                where: args.where,
                select: { tenantId: true },
              });
              if (existing && existing.tenantId && existing.tenantId !== tenantId) {
                throw new Error(
                  `Tentative de upsert sur ${model} hors du tenant courant (${tenantId} attendu, ${existing.tenantId} trouvé).`
                );
              }
            }
            const createData = (args.create as Record<string, unknown>) ?? {};
            if (createData.tenantId === undefined) createData.tenantId = tenantId;
            args.create = createData;
            return query(args);
          }
          case "create": {
            const data = (args.data as Record<string, unknown>) ?? {};
            if (data.tenantId === undefined) data.tenantId = tenantId;
            args.data = data;
            return query(args);
          }
          case "createMany":
          case "createManyAndReturn": {
            const data = args.data as Record<string, unknown> | Array<Record<string, unknown>>;
            if (Array.isArray(data)) {
              args.data = data.map((d) => (d.tenantId === undefined ? { ...d, tenantId } : d));
            } else {
              const d = data as { tenantId?: string };
              args.data = d.tenantId === undefined ? { ...data, tenantId } : data;
            }
            return query(args);
          }
          case "findUnique":
          case "findUniqueOrThrow": {
            const result = await query(args);
            const tenantIdOnResult = (result as { tenantId?: string } | null)?.tenantId;
            if (result && tenantIdOnResult && tenantIdOnResult !== tenantId) {
              // Trouvé mais dans un autre tenant → on masque comme s'il n'existait pas.
              if (operation === "findUniqueOrThrow") {
                throw new Error(`No ${model} found`);
              }
              return null;
            }
            return result;
          }
          default:
            return query(args);
        }
      },
    },
  },
});
