"use client";

import { useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

const HEARTBEAT_INTERVAL = 60_000; // 60 seconds
const FORCE_INTERVAL = 5 * 60_000; // 5 minutes — send even if page unchanged
const SESSION_KEY = "bj_heartbeat_session";

/**
 * Sends a heartbeat to /api/heartbeat every 60 seconds while the user is
 * authenticated. Skips redundant calls if the page hasn't changed (forces
 * every 5 min). On browser/tab close, sends a disconnect signal via
 * navigator.sendBeacon so the admin dashboard immediately sees the user
 * as offline.
 */
export default function HeartbeatTracker() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const lastSentPageRef = useRef<string | null>(null);
  const lastSentAtRef = useRef(0);

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

    const sendHeartbeat = async (newSession = false, force = false) => {
      const page = pathnameRef.current;
      const now = Date.now();

      // Skip if page unchanged and last sent recently (unless forced)
      if (
        !force &&
        !newSession &&
        page === lastSentPageRef.current &&
        now - lastSentAtRef.current < FORCE_INTERVAL
      ) {
        return;
      }

      try {
        const res = await fetch("/api/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, isNewSession: newSession }),
        });
        if (res.status === 401) {
          signOut({ callbackUrl: "/connexion" });
          return;
        }
        lastSentPageRef.current = page;
        lastSentAtRef.current = now;
      } catch {
        // Silently ignore network failures
      }
    };

    const sendDisconnect = () => {
      navigator.sendBeacon("/api/heartbeat/disconnect");
    };

    // First heartbeat: flag as new session if applicable
    sendHeartbeat(isNewSession, true);

    const interval = setInterval(() => sendHeartbeat(false), HEARTBEAT_INTERVAL);

    window.addEventListener("beforeunload", sendDisconnect);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        sendHeartbeat(false, true);
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
