"use client";

/**
 * Suivi client-side des pushs Microstore en action groupée.
 *
 * Contexte : les propagations Microstore lancées depuis `admin/produits`
 * (bulk apply des modifs variantes, bulk apply des changements de statut,
 * etc.) n'utilisent PAS la file `MarketplaceRefreshQueue` — elles appellent
 * directement la server action `bulkPushProductsToMicrostore` en fire-and-forget
 * pour ne faire QU'UN seul POST photos côté Microstore (évite les collisions
 * HTTP 500 quand plusieurs pushs unitaires uploadent leurs photos en même temps).
 *
 * Conséquence : sans ce contexte, le badge Microstore de chaque produit
 * concerné restait sur son état précédent (rouge/orange) pendant toute la
 * durée du push puis basculait vert d'un coup. Les autres marketplaces
 * (PFS/Ankor/eFa/Faire) montrent bien un état bleu « En cours » car elles
 * passent par la file et remontent `microstoreBadgeState.loading = true`.
 *
 * Ce contexte comble le trou : on marque les productIds "en cours de bulk
 * push Microstore" au démarrage, on les enlève à la fin — chaque badge lit
 * `isBulkPushing(productId)` et l'ajoute à son état de chargement local.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Value {
  /** True si un push bulk Microstore est actuellement en cours pour ce produit. */
  isBulkPushing: (productId: string) => boolean;
  /**
   * Marque une liste de productIds comme "en cours" pendant l'exécution de
   * `executor`, puis les retire (même en cas d'erreur). Fire-and-forget côté
   * appelant : la promesse retournée n'est PAS chaînée dans l'UI, mais son
   * résultat contrôle bien le cycle de vie du flag.
   */
  runBulkPush: (productIds: string[], executor: () => Promise<void>) => void;
}

const Ctx = createContext<Value | null>(null);

export function MicrostoreBulkPushProvider({ children }: { children: ReactNode }) {
  // Set immuable : chaque mutation crée un nouveau Set pour que les consumers
  // (qui lisent via `isBulkPushing`) re-render — un mutable Set garderait la
  // même référence et n'invaliderait pas les hooks dépendants.
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const isBulkPushing = useCallback((productId: string) => ids.has(productId), [ids]);

  const runBulkPush = useCallback(
    (productIds: string[], executor: () => Promise<void>) => {
      if (productIds.length === 0) {
        void executor();
        return;
      }
      setIds((prev) => {
        const next = new Set(prev);
        for (const id of productIds) next.add(id);
        return next;
      });
      void (async () => {
        try {
          await executor();
        } catch {
          // Fire-and-forget par design : l'appelant remonte déjà les erreurs
          // via toast. On absorbe ici pour ne pas laisser fuiter une unhandled
          // rejection (bruit dans les logs + crash reporter). Le finally
          // garantit malgré tout que les flags sont relâchés.
        } finally {
          setIds((prev) => {
            const next = new Set(prev);
            for (const id of productIds) next.delete(id);
            return next;
          });
        }
      })();
    },
    [],
  );

  const value = useMemo<Value>(
    () => ({ isBulkPushing, runBulkPush }),
    [isBulkPushing, runBulkPush],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMicrostoreBulkPush(): Value {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useMicrostoreBulkPush doit être appelé dans un <MicrostoreBulkPushProvider>.",
    );
  }
  return v;
}
