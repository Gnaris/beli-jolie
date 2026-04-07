"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 15_000;

export default function MaintenancePoller() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const res = await fetch("/api/site-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { maintenance: boolean };
        if (!data.maintenance && active) {
          router.replace("/");
        }
      } catch {
        // ignore network errors, retry next interval
      }
    }

    // Check immediately on mount (covers page refresh)
    check();

    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
