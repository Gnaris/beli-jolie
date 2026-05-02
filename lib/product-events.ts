/**
 * In-memory event emitter for real-time product updates via SSE.
 * Uses globalThis to guarantee a single shared instance across
 * Next.js server actions, API routes, and middleware.
 */

export type ProductEventType = "PRODUCT_ONLINE" | "PRODUCT_UPDATED" | "PRODUCT_OFFLINE" | "STOCK_CHANGED" | "BESTSELLER_CHANGED" | "PRODUCT_CREATED" | "IMPORT_PROGRESS" | "MARKETPLACE_SYNC";

export type MarketplaceId = "pfs";

export interface MarketplaceSyncProgress {
  /** Which marketplace */
  marketplace: MarketplaceId;
  /** Current step label (displayed to user) */
  step: string;
  /** 0–100 progress percentage */
  progress: number;
  /** Overall status */
  status: "pending" | "in_progress" | "success" | "error";
  /** Error message if status is "error" */
  error?: string;
}

export interface ImportProgressResult {
  pfsId: string;
  status: "ok" | "error" | "cancelled";
  productId?: string;
  error?: string;
}

export interface ProductEvent {
  type: ProductEventType;
  productId: string;
  timestamp: number;
  /** Import progress metadata (only for IMPORT_PROGRESS events) */
  importProgress?: {
    jobId: string;
    processed: number;
    total: number;
    success: number;
    errors: number;
    status: "PROCESSING" | "COMPLETED" | "FAILED";
    /**
     * Résultats par produit déjà traités au moment de l'émission. Permet à
     * l'UI d'afficher le bon badge (Prêt / Erreur) pour chaque ligne même
     * quand l'import tourne en parallèle — le simple compteur `processed`
     * ne suffit pas à savoir QUELS produits sont finis.
     */
    results?: ImportProgressResult[];
    /** Concurrence effective du worker (pour l'UI : savoir combien de
     *  produits sont simultanément en cours d'import). */
    concurrency?: number;
  };
  /** Marketplace sync progress (only for MARKETPLACE_SYNC events) */
  marketplaceSync?: MarketplaceSyncProgress;
}

type Listener = (event: ProductEvent) => void;

const GLOBAL_KEY = "__bj_product_event_listeners__" as const;

function getListeners(): Set<Listener> {
  const g = globalThis as unknown as Record<string, Set<Listener>>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Set<Listener>();
  }
  return g[GLOBAL_KEY];
}

export function emitProductEvent(event: Omit<ProductEvent, "timestamp">) {
  const full: ProductEvent = { ...event, timestamp: Date.now() };
  const listeners = getListeners();
  for (const listener of listeners) {
    try { listener(full); } catch { /* ignore */ }
  }
}

export function subscribeProductEvents(listener: Listener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
