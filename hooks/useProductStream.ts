"use client";

import { useEffect, useRef } from "react";
import { subscribeSSE } from "@/lib/shared-sse";

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

/**
 * Subscribe to real-time product events via shared SSE.
 * Calls `onEvent` for each incoming event. Uses a shared EventSource
 * to avoid exhausting the browser's connection limit.
 */
export function useProductStream(onEvent: (event: ProductEvent) => void) {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    const unsubscribe = subscribeSSE((data) => {
      const event = data as ProductEvent;
      if (event.type && event.productId) {
        onEventRef.current(event);
      }
    });

    return unsubscribe;
  }, []);
}
