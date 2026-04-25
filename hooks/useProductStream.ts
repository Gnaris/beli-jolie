"use client";

import { useEffect, useRef } from "react";
import { subscribeSSE } from "@/lib/shared-sse";
import type { ProductEvent, ProductEventType } from "@/lib/product-events";

export type { ProductEvent, ProductEventType };

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
