"use client";

import { useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const SESSION_KEY = "bj_heartbeat_session";

/**
 * Sends a heartbeat to /api/heartbeat every 30 seconds while the user is
 * authenticated. Tracks session start, cart/fav counts (server-side), and
 * current page. On browser/tab close, sends a disconnect signal via
 * navigator.sendBeacon so the admin dashboard immediately sees the user
 * as offline.
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

    // Detect new browsing session via sessionStorage
    // sessionStorage is cleared when the browser closes
    const isNewSession = !sessionStorage.getItem(SESSION_KEY);
    if (isNewSession) {
      sessionStorage.setItem(SESSION_KEY, Date.now().toString());
    }

    const sendHeartbeat = async (newSession = false) => {
      try {
        const res = await fetch("/api/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: pathnameRef.current,
            isNewSession: newSession,
          }),
        });
        if (res.status === 401) {
          // User no longer exists in DB — clear session and redirect
          signOut({ callbackUrl: "/connexion" });
        }
      } catch {
        // Silently ignore network failures
      }
    };

    const sendDisconnect = () => {
      // sendBeacon is reliable even during page unload
      navigator.sendBeacon("/api/heartbeat/disconnect");
    };

    // First heartbeat: flag as new session if applicable
    sendHeartbeat(isNewSession);

    const interval = setInterval(() => sendHeartbeat(false), HEARTBEAT_INTERVAL);

    // Signal disconnect when the browser/tab is closed
    window.addEventListener("beforeunload", sendDisconnect);

    // Re-send heartbeat when tab becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        sendHeartbeat(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", sendDisconnect);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status, session?.user]);

  return null;
}
