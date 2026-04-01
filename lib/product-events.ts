/**
 * In-memory event emitter for real-time product updates via SSE.
 * Uses globalThis to guarantee a single shared instance across
 * Next.js server actions, API routes, and middleware.
 */

export type ProductEventType = "PRODUCT_ONLINE" | "PRODUCT_UPDATED" | "PRODUCT_OFFLINE" | "STOCK_CHANGED" | "BESTSELLER_CHANGED" | "PRODUCT_CREATED" | "IMPORT_PROGRESS";

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
  };
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
