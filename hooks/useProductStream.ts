"use client";

import { useEffect, useRef } from "react";

export type ProductEventType = "PRODUCT_ONLINE" | "PRODUCT_UPDATED" | "PRODUCT_OFFLINE" | "STOCK_CHANGED" | "BESTSELLER_CHANGED";

export interface ProductEvent {
  type: ProductEventType;
  productId: string;
  timestamp: number;
}

/**
 * Subscribe to real-time product events via SSE.
 * Calls `onEvent` for each incoming event. Auto-reconnects on disconnect.
 */
export function useProductStream(onEvent: (event: ProductEvent) => void) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    function connect() {
      if (!alive) return;
      es = new EventSource("/api/products/stream");

      es.onmessage = (msg) => {
        try {
          const event: ProductEvent = JSON.parse(msg.data);
          onEventRef.current(event);
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        es?.close();
        if (alive) reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);
}
