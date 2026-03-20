"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lightweight SSE client that shows the number of currently online clients
 * as a small green badge. Used in both desktop sidebar and mobile nav.
 */
export default function LiveCountBadge() {
  const [count, setCount] = useState<number>(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/admin/live-clients");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "update" && Array.isArray(data.clients)) {
          setCount(data.clients.length);
        }
      } catch {
        /* skip */
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  if (count === 0) return null;

  return (
    <span className="flex items-center gap-1 text-[11px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5 font-medium shrink-0 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {count}
    </span>
  );
}
