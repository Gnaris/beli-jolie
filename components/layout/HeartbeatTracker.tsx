"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

/**
 * Sends a heartbeat to /api/heartbeat every 30 seconds while the user is
 * authenticated. Included in the root layout so it runs on every page.
 */
export default function HeartbeatTracker() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  // Keep pathname ref up-to-date without re-triggering the effect
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;

    const sendHeartbeat = () => {
      fetch("/api/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: pathnameRef.current }),
      }).catch(() => {
        // Silently ignore heartbeat failures
      });
    };

    // Send immediately on mount / auth change
    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, [status, session?.user]);

  return null;
}
