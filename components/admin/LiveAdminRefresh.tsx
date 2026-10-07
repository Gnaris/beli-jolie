"use client";

import { useRouter } from "next/navigation";
import { useAdminStream } from "@/hooks/useAdminStream";
import { useToast } from "@/components/ui/Toast";
import type { AdminEventType } from "@/lib/admin-events";

interface Props {
  /** Types d'événements qui déclenchent un router.refresh() sur cette page. */
  events: readonly AdminEventType[];
  /**
   * Messages toast optionnels par type d'événement. Si absent, le refresh
   * se fait sans notification visible — utile pour /admin/clients qui a
   * déjà la pastille animée en ligne.
   */
  toasts?: Partial<Record<AdminEventType, string>>;
}

/**
 * Monte un abonnement SSE discret dans un Server Component admin : à chaque
 * event listé, invalide le cache côté client et refetch la page. Le state
 * local des composants client (compteurs, formulaires ouverts…) est préservé
 * par Next — seuls les Server Components sont re-rendus.
 */
export default function LiveAdminRefresh({ events, toasts }: Props) {
  const router = useRouter();
  const { info } = useToast();

  useAdminStream((event) => {
    const label = toasts?.[event.type];
    if (label) info(label);
    router.refresh();
  }, events);

  return null;
}
