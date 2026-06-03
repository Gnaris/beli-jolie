"use client";

import { useSession } from "next-auth/react";
import { useHeartbeat } from "@/hooks/useHeartbeat";

/**
 * Monte le heartbeat de présence uniquement pour les clients connectés
 * (role CLIENT, n'importe quel statut). Ne rend rien à l'écran.
 *
 * Placé dans `app/layout.tsx` à côté de ChatWidgetLoader.
 */
export default function HeartbeatLoader() {
  const { data: session } = useSession();
  const enabled = session?.user.role === "CLIENT";
  useHeartbeat(enabled);
  return null;
}
