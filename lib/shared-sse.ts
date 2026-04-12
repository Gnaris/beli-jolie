/**
 * Shared SSE connection singleton.
 * Prevents multiple EventSource connections to /api/products/stream
 * which would exhaust the browser's HTTP/1.1 connection limit (6 per origin).
 *
 * All consumers (useProductStream, MarketplaceSyncOverlay, etc.) share
 * a single EventSource via subscribe/unsubscribe. The connection opens
 * when the first subscriber appears and closes when the last one leaves.
 */

type SSEListener = (data: unknown) => void;

let eventSource: EventSource | null = null;
const listeners = new Set<SSEListener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let alive = false;

function connect() {
  if (!alive) return;
  if (eventSource) return; // already connected

  const es = new EventSource("/api/products/stream");
  eventSource = es;

  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      for (const listener of listeners) {
        try { listener(data); } catch { /* ignore */ }
      }
    } catch { /* ignore malformed */ }
  };

  es.onerror = () => {
    es.close();
    eventSource = null;
    if (alive && listeners.size > 0) {
      reconnectTimer = setTimeout(connect, 5000);
    }
  };
}

function disconnect() {
  alive = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

/**
 * Subscribe to the shared SSE stream.
 * Returns an unsubscribe function. When the last subscriber leaves,
 * the EventSource is closed to free the HTTP connection.
 */
export function subscribeSSE(listener: SSEListener): () => void {
  listeners.add(listener);

  // Start connection if this is the first subscriber
  if (listeners.size === 1) {
    alive = true;
    connect();
  }

  return () => {
    listeners.delete(listener);
    // Close connection when no more subscribers
    if (listeners.size === 0) {
      disconnect();
    }
  };
}
