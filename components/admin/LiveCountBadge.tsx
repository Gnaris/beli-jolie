"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight polling client that shows the number of currently online clients
 * as a small green badge. Uses polling instead of SSE to avoid consuming
 * a persistent HTTP connection (browser limits to 6 per origin in HTTP/1.1).
 */
export default function LiveCountBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch("/api/admin/live-clients/count");
        if (res.ok && alive) {
          const data = await res.json();
          setCount(data.count ?? 0);
        }
      } catch { /* ignore */ }
    }

    poll();
    const interval = setInterval(poll, 30_000); // Poll every 30s

    return () => {
      alive = false;
      clearInterval(interval);
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
