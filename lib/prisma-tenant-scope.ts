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
  "Promotion",
  "PromotionCategory",
  "PromotionCollection",
  "PromotionProduct",
  "PromotionUsage",
  "Catalog",
  "CatalogProduct",
  "ImportJob",
  "ImportDraft",
  "RestockAlert",
  "AnkorstoreOperation",
  "MarketplaceRefreshJob",
  "EfashionShootingBatchItem",
  "ImageProcessingJob",
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
        if (!TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }
        const tenantId = await getTenantIdFromRequest();
        if (!tenantId) {
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
