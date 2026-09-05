"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { MarketplaceRefreshOptions } from "@/app/actions/admin/marketplace-refresh";
import { useToast } from "@/components/ui/Toast";

export type QueueItemStatus = "queued" | "in_progress" | "awaiting_callback" | "done";

/**
 * "refresh" = renouveler un produit déjà publié (recrée côté marketplace).
 * "publish" = première mise en ligne ou update incrémental.
 * "resync"  = renvoyer toutes les données sur le même id marketplace.
 * "disable" = masquer le produit (visible → invisible) sans supprimer la fiche.
 * "enable"  = réafficher un produit précédemment masqué.
 * "delete"  = suppression définitive de la fiche côté marketplace.
 * Actuellement les 3 derniers ne sont produits que par Microstore.
 */
export type QueueItemMode = "refresh" | "publish" | "resync" | "disable" | "enable" | "delete";

export type MarketplaceTarget = "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";

export type TargetOutcome =
  | { ok: true; archived?: boolean; opId?: string; warning?: string }
  | { ok: false; kind: "not_found" | "error"; message: string };

/**
 * Une étape sérialisée dans job.steps par le worker marketplace.
 * Miroir de lib/marketplace-job-steps.ts::StepEntry — dupliqué ici pour
 * garder MarketplaceRefreshContext utilisable côté client sans dépendance
 * transitive vers Prisma. Toute évolution serveur (nouveau kind, nouveau
 * status) doit être répercutée ici et dans STEP_LABELS_FR ci-dessous.
 */
export interface JobStepEntry {
  kind: string;
  label?: string;
  status: "pending" | "in_progress" | "done" | "error" | "skipped";
  startedAt?: string;
  completedAt?: string;
  message?: string;
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
}

export interface MarketplaceRefreshItem {
  id: string;
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  options: MarketplaceRefreshOptions;
  mode: QueueItemMode;
  marketplace: MarketplaceTarget;
  status: QueueItemStatus;
  localOutcome?: TargetOutcome;
  pfsOutcome?: TargetOutcome;
  ankorsOutcome?: TargetOutcome;
  efashionOutcome?: TargetOutcome;
  faireOutcome?: TargetOutcome;
  orderchampOutcome?: TargetOutcome;
  microstoreOutcome?: TargetOutcome;
  ankorsOperationId?: string;
  /** ISO date. Présent quand le job attend une heure de départ future (étalement). */
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  /**
   * Intention métier du job — sert au drawer marketplaces à router chaque
   * job vers l'onglet correspondant (Création / Modification / Liaison /
   * Rafraîchissement / Étalement).
   * Depuis 2026-08-14 : posé serveur-side à l'enqueue et persisté en base
   * (colonne MarketplaceRefreshJob.intent). Fallback client "create"/"update"
   * ancien reste supporté pour compat retro tant que l'ancien code appelant
   * pose l'intent côté enqueue().
   */
  intent?: "create" | "update" | "sync" | "refresh" | "scheduled" | "link";
  /**
   * Progression étape par étape poussée par le worker au fur et à mesure
   * (validation → auth → création produit → variantes → images → publish →
   * sauvegarde IDs). Absent = job antérieur à l'instrumentation ou branche
   * pas encore instrumentée — le drawer affiche alors juste le statut global.
   */
  steps?: JobStepEntry[];
}

export interface MarketplaceRefreshEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  options: MarketplaceRefreshOptions;
  /** Default = "refresh". */
  mode?: QueueItemMode;
  /** Marketplace cible — défaut "pfs". */
  marketplace?: MarketplaceTarget;
  /** Intention client — "create" = première publication (fiche non existante
   *  chez le marketplace), sinon "update" par défaut. Depuis 2026-08-14 le
   *  serveur re-résout systématiquement l'intent à l'enqueue (via présence
   *  d'un ID marketplace) et le persiste ; le hint client reste posé dans la
   *  Map locale pour l'affichage optimiste avant le premier poll. */
  intent?: "create" | "update";
  /**
   * Optionnel : actions ciblées produites par le tooltip « PFS Verify » (envoi
   * granulaire par champ). Quand présent, le worker exécute
   * `applyPfsVerifyActionsCore` au lieu de la sync marketplace standard.
   * `marketplace` doit être `"pfs"` dans ce cas.
   */
  verifyActions?: { key: string; direction: "push" | "pull" }[];
}

export interface EnqueueMeta {
  /** Étalement du lot en ms. 0 ou absent = tous les produits partent en même temps. */
  intervalMs?: number;
}

interface MarketplaceRefreshContextValue {
  items: MarketplaceRefreshItem[];
  enqueue: (inputs: MarketplaceRefreshEnqueueInput[], meta?: EnqueueMeta) => void;
  clear: () => void;
  /** Sans argument : arrête tous les queued. Avec `mode` : ne stoppe que
   *  les queued de ce mode (permet d'arrêter uniquement les rafraîchissements
   *  sans toucher aux modifications). */
  stop: (mode?: QueueItemMode) => void;
  /** Retire une ou plusieurs lignes du widget (jobs QUEUED / SUCCEEDED /
   *  FAILED marqués CANCELLED côté serveur). Les jobs actifs
   *  (IN_PROGRESS / AWAITING_CALLBACK) sont laissés intacts. */
  dismiss: (ids: string[]) => void;
  /**
   * Rejoue les items en erreur : dismiss les FAILED donnés PUIS enqueue les
   * nouveaux inputs. Sans le dismiss synchrone, le prochain poll ré-affiche
   * les FAILED (encore présents en BDD tant que /dismiss n'a pas complété)
   * et l'ErrorPanel reste rouge avec le bouton « Relancer » toujours actif
   * — la cliente peut alors re-cliquer en boucle sans voir le nouveau job.
   */
  retry: (errorItemIds: string[], inputs: MarketplaceRefreshEnqueueInput[]) => void;
  isAllFinished: boolean;
  runningCount: number;
  queuedCount: number;
  /** productIds avec au moins un item actif (queued, in_progress, awaiting_callback). */
  inFlightProductIds: Set<string>;
  /**
   * Timestamp CLIENT (ms epoch) de la dernière fois où ce couple
   * (productId, marketplace) a été vu passer à `done` avec succès. `null` si
   * aucun succès jamais vu ou si l'entrée a expiré. Utilisé par le badge pour
   * masquer le orange « Synchro nécessaire » indépendamment de ce que renvoie
   * ensuite le serveur (poll perdu, décalage d'horloge, RSC en retard…).
   */
  getRecentClientSuccessAt: (
    productId: string,
    marketplace: MarketplaceTarget,
  ) => number | null;
  /**
   * Force un poll immédiat de la file marketplace. À utiliser par les
   * providers voisins (ex : commit du shooting eFashion) qui viennent de
   * créer des MarketplaceRefreshJob côté serveur et veulent voir les jobs
   * apparaître instantanément dans le context — sinon on attend le tick
   * de polling suivant (jusqu'à 10 s en idle), pendant lequel les badges
   * marketplace repassent en « hors ligne » alors qu'un push est en cours
   * et le bouton « Publier » redevient cliquable.
   */
  refetch: () => Promise<void>;
}

export function isItemActive(item: MarketplaceRefreshItem): boolean {
  return (
    item.status === "queued" ||
    item.status === "in_progress" ||
    item.status === "awaiting_callback"
  );
}

export function hasError(item: MarketplaceRefreshItem): boolean {
  if (item.pfsOutcome && !item.pfsOutcome.ok) return true;
  if (item.ankorsOutcome && !item.ankorsOutcome.ok) return true;
  if (item.efashionOutcome && !item.efashionOutcome.ok) return true;
  if (item.faireOutcome && !item.faireOutcome.ok) return true;
  if (item.orderchampOutcome && !item.orderchampOutcome.ok) return true;
  if (item.microstoreOutcome && !item.microstoreOutcome.ok) return true;
  return false;
}

const MarketplaceRefreshContext = createContext<MarketplaceRefreshContextValue | null>(null);

export function useMarketplaceRefreshQueue(): MarketplaceRefreshContextValue {
  const ctx = useContext(MarketplaceRefreshContext);
  if (!ctx) {
    throw new Error("useMarketplaceRefreshQueue must be used within <MarketplaceRefreshProvider>");
  }
  return ctx;
}

/**
 * Cadence du polling : 2s tant qu'il reste des items actifs (queued / in_progress /
 * awaiting_callback), 10s en idle pour capter les changements venant d'un autre
 * onglet ou d'un push depuis une autre fenêtre admin.
 */
const POLL_ACTIVE_MS = 2_000;
const POLL_IDLE_MS = 10_000;

// Durée pendant laquelle on garde en mémoire côté client qu'un couple
// (productId, marketplace) vient de terminer une sync avec succès. Sert à
// masquer le badge orange « Synchro nécessaire » même si :
//   - le poll perd temporairement l'item (renvoi vide, purge…) ;
//   - l'horloge serveur est décalée par rapport au client ;
//   - le RSC met du temps à rapatrier `syncRequired=false` après router.refresh.
// 5 minutes couvre largement le pire cas (tableau produits lourd + tenants
// nombreux). Au-delà, la source de vérité redevient la prop RSC.
const CLIENT_SUCCESS_WINDOW_MS = 5 * 60 * 1000;

// Renvoie l'outcome typé du marketplace ciblé — null si non défini.
function outcomeForMarketplace(
  item: MarketplaceRefreshItem,
  target: MarketplaceTarget,
): TargetOutcome | undefined {
  if (target === "ankorstore") return item.ankorsOutcome;
  if (target === "efashion") return item.efashionOutcome;
  if (target === "faire") return item.faireOutcome;
  if (target === "orderchamp") return item.orderchampOutcome;
  if (target === "microstore") return item.microstoreOutcome;
  return item.pfsOutcome;
}

export function MarketplaceRefreshProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MarketplaceRefreshItem[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const router = useRouter();
  const toast = useToast();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDoneCountRef = useRef<number>(0);
  const inFlightFetchRef = useRef<boolean>(false);

  // Mémoire des intents "create" (première publication). Clé =
  // `${productId}:${marketplace}:${mode}`. Alimentée par enqueue() quand
  // l'appelant précise intent === "create" (ex : MarketplaceStatusButtons
  // clique « Publier » sur un produit sans ID marketplace connu). Consommée
  // au moment du build des items côté drawer pour router la carte vers la
  // colonne « Publication » plutôt que « Modifications ». Purgée quand
  // l'item est retiré ou terminé + dismiss.
  const [intentMap, setIntentMap] = useState<Map<string, "create">>(
    () => new Map(),
  );
  const intentKey = (productId: string, marketplace: MarketplaceTarget, mode: QueueItemMode) =>
    `${productId}:${marketplace}:${mode}`;

  // Mémoire client-side des dernières sync réussies. Clé = `${productId}:${marketplace}`,
  // valeur = timestamp CLIENT (Date.now) au moment où on a détecté la transition
  // vers done+ok. Immuable au niveau id de la Map — on remplace l'instance à
  // chaque update pour forcer le re-render.
  const [clientSuccessMap, setClientSuccessMap] = useState<Map<string, number>>(
    () => new Map(),
  );
  const clientSuccessKey = (productId: string, marketplace: MarketplaceTarget) =>
    `${productId}:${marketplace}`;

  // ── Poll de la file côté serveur ──────────────────────────────────
  const pollOnce = useCallback(async () => {
    if (inFlightFetchRef.current) return;
    inFlightFetchRef.current = true;
    try {
      const res = await fetch("/api/admin/marketplace-queue", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: MarketplaceRefreshItem[] };
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems(nextItems);

      // Enrichit la mémoire client : pour chaque item done avec outcome ok sur
      // son marketplace, on note le timestamp de complétion RÉEL (côté serveur)
      // pour rendre le sticky green robuste face aux races (poll perdu,
      // décalage d'horloge, RSC en retard). On utilise `item.completedAt` et
      // PAS `Date.now()` — sinon une op terminée il y a des jours et toujours
      // renvoyée par l'API se verrait attribuer un timestamp « maintenant » et
      // masquerait le badge orange « Synchro nécessaire » perpétuellement
      // (bug retrouvé 2026-07-29 : après avoir marqué un produit à resync via
      // « Masquer Made in », le badge restait vert car la file contenait encore
      // l'op resync du dernier push).
      const now = Date.now();
      let mutated = false;
      const nextMap = new Map(clientSuccessMap);
      for (const item of nextItems) {
        if (item.status !== "done") continue;
        const outcome = outcomeForMarketplace(item, item.marketplace);
        if (!outcome || outcome.ok !== true) continue;
        const completedAtMs = item.completedAt ? Date.parse(item.completedAt) : NaN;
        if (!Number.isFinite(completedAtMs)) continue;
        // Ignore les ops terminées hors de la fenêtre de grâce : elles ne
        // doivent pas masquer un badge orange légitime posé après-coup
        // (par ex. depuis Admin > Paramètres > Faire > Masquer Made in).
        if (now - completedAtMs > CLIENT_SUCCESS_WINDOW_MS) continue;
        const key = clientSuccessKey(item.productId, item.marketplace);
        const existing = nextMap.get(key);
        if (existing === undefined || existing < completedAtMs) {
          nextMap.set(key, completedAtMs);
          mutated = true;
        }
      }
      // Purge les entrées trop vieilles pour éviter que la Map ne grossisse
      // indéfiniment sur une session admin longue.
      const cutoff = now - CLIENT_SUCCESS_WINDOW_MS;
      for (const [key, ts] of nextMap) {
        if (ts < cutoff) {
          nextMap.delete(key);
          mutated = true;
        }
      }
      if (mutated) setClientSuccessMap(nextMap);
    } catch {
      // Réseau coupé / serveur indisponible : prochain tick retentera
    } finally {
      inFlightFetchRef.current = false;
    }
  }, [clientSuccessMap]);

  useEffect(() => {
    // Premier poll immédiat au montage
    void pollOnce();
  }, [pollOnce]);

  // Suivi de la visibilité de l'onglet — quand l'admin change d'onglet ou
  // minimise la fenêtre, on coupe le polling pour ne pas saturer le réseau
  // ni la batterie.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // Re-poll immédiat quand l'onglet redevient visible : capte les changements
  // survenus pendant que la page était en arrière-plan.
  useEffect(() => {
    if (isVisible) void pollOnce();
  }, [isVisible, pollOnce]);

  // Polling adaptatif : 2s si du travail tourne, 10s sinon. Coupé si caché.
  const hasActive = items.some(isItemActive);
  useEffect(() => {
    if (!isVisible) return;
    const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const interval = setInterval(() => {
      void pollOnce();
    }, delay);
    return () => clearInterval(interval);
  }, [hasActive, isVisible, pollOnce]);

  // ── Actions : enqueue / clear / stop ──────────────────────────────
  const enqueue = useCallback(
    (inputs: MarketplaceRefreshEnqueueInput[], meta?: EnqueueMeta) => {
      if (inputs.length === 0) return;
      const intervalMs =
        meta?.intervalMs && Number.isFinite(meta.intervalMs) && meta.intervalMs > 0
          ? meta.intervalMs
          : 0;

      // Enregistre les intents "create" AVANT le POST — comme ça, si des
      // items reviennent en optimiste avant même le prochain poll, ils
      // porteront déjà la bonne intention.
      const createEntries: [string, "create"][] = [];
      for (const inp of inputs) {
        if (inp.intent !== "create") continue;
        const mode = inp.mode ?? "refresh";
        const marketplace = inp.marketplace ?? "pfs";
        createEntries.push([intentKey(inp.productId, marketplace, mode), "create"]);
      }
      if (createEntries.length > 0) {
        setIntentMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of createEntries) next.set(k, v);
          return next;
        });
      }
      void (async () => {
        try {
          const res = await fetch("/api/admin/marketplace-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: inputs, intervalMs }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              items: MarketplaceRefreshItem[];
              skipped?: number;
              skippedByMarketplace?: Record<string, number>;
            };
            // Update optimiste à partir de la réponse immédiate, puis re-poll
            if (Array.isArray(data.items) && data.items.length > 0) {
              setItems((prev) => {
                const existingIds = new Set(prev.map((i) => i.id));
                const fresh = data.items.filter((i) => !existingIds.has(i.id));
                return [...prev, ...fresh];
              });
            }
            // Feedback quand des items ont été sautés parce que le marketplace
            // est désactivé pour ce produit dans la fiche produit.
            if (typeof data.skipped === "number" && data.skipped > 0) {
              const parts: string[] = [];
              const by = data.skippedByMarketplace ?? {};
              if (by.pfs) parts.push(`${by.pfs} PFS`);
              if (by.ankorstore) parts.push(`${by.ankorstore} Ankorstore`);
              if (by.efashion) parts.push(`${by.efashion} eFashion`);
              if (by.faire) parts.push(`${by.faire} Faire`);
              const detail = parts.join(" · ");
              const accepted = data.items?.length ?? 0;
              toast.warning(
                accepted > 0
                  ? `${accepted} envoi(s) lancé(s), ${data.skipped} sauté(s)`
                  : `${data.skipped} envoi(s) sauté(s)`,
                detail
                  ? `Marketplace désactivée pour ces produits : ${detail}. Réactivez depuis la fiche produit.`
                  : "Marketplace désactivée pour ces produits.",
              );
            }
          }
        } catch {
          // ignoré — le prochain poll réconciliera
        } finally {
          void pollOnce();
        }
      })();
    },
    [pollOnce],
  );

  const clear = useCallback(() => {
    void (async () => {
      try {
        await fetch("/api/admin/marketplace-queue/clear", { method: "POST" });
      } catch {
        // ignored
      } finally {
        void pollOnce();
      }
    })();
  }, [pollOnce]);

  const stop = useCallback(
    (mode?: QueueItemMode) => {
      void (async () => {
        try {
          await fetch("/api/admin/marketplace-queue/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mode ? { mode } : {}),
          });
        } catch {
          // ignored
        } finally {
          void pollOnce();
        }
      })();
    },
    [pollOnce],
  );

  const dismiss = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      // Retrait optimiste — évite le sentiment de latence côté UI, le prochain
      // poll réconciliera si le serveur a refusé (ex : job passé IN_PROGRESS
      // entre-temps).
      setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      void (async () => {
        try {
          await fetch("/api/admin/marketplace-queue/dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
        } catch {
          // ignored
        } finally {
          void pollOnce();
        }
      })();
    },
    [pollOnce],
  );

  // Relance atomique : on retire les items en erreur (optimiste + serveur)
  // AVANT d'enfiler les nouveaux — sinon le poll qui suit l'enqueue voit
  // encore les FAILED en BDD, l'ErrorPanel rouge se ré-affiche et le bouton
  // « Relancer » reste actif (incident 05/09/2026 remonté par la cliente).
  const retry = useCallback(
    (errorItemIds: string[], inputs: MarketplaceRefreshEnqueueInput[]) => {
      if (errorItemIds.length === 0 && inputs.length === 0) return;

      // Optimistes : cache les erreurs et pose les nouveaux en "queued" tout
      // de suite pour que la cliente voie le produit repasser en chargement.
      if (errorItemIds.length > 0) {
        setItems((prev) => prev.filter((i) => !errorItemIds.includes(i.id)));
      }

      // Note les intents "create" pour héritage optimiste (comme enqueue).
      const createEntries: [string, "create"][] = [];
      for (const inp of inputs) {
        if (inp.intent !== "create") continue;
        const mode = inp.mode ?? "refresh";
        const marketplace = inp.marketplace ?? "pfs";
        createEntries.push([intentKey(inp.productId, marketplace, mode), "create"]);
      }
      if (createEntries.length > 0) {
        setIntentMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of createEntries) next.set(k, v);
          return next;
        });
      }

      void (async () => {
        // Étape 1 : dismiss côté serveur — on ATTEND avant l'enqueue pour que
        // le prochain poll ne renvoie plus les FAILED.
        if (errorItemIds.length > 0) {
          try {
            await fetch("/api/admin/marketplace-queue/dismiss", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: errorItemIds }),
            });
          } catch {
            // ignored
          }
        }
        // Étape 2 : enqueue des nouveaux jobs
        if (inputs.length > 0) {
          try {
            const res = await fetch("/api/admin/marketplace-queue", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: inputs, intervalMs: 0 }),
            });
            if (res.ok) {
              const data = (await res.json()) as {
                items: MarketplaceRefreshItem[];
              };
              if (Array.isArray(data.items) && data.items.length > 0) {
                setItems((prev) => {
                  const existingIds = new Set(prev.map((i) => i.id));
                  const fresh = data.items.filter((i) => !existingIds.has(i.id));
                  return [...prev, ...fresh];
                });
              }
            }
          } catch {
            // ignored
          }
        }
        void pollOnce();
      })();
    },
    [pollOnce],
  );

  // ── Refresh RSC quand des items basculent en "done" ───────────────
  // Comme avant : on rafraîchit les données serveur (badges marketplace,
  // date du dernier rafraîchissement…) sans recharger toute la page.
  const doneCount = items.filter((i) => i.status === "done").length;
  useEffect(() => {
    if (doneCount > lastDoneCountRef.current) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        router.refresh();
        refreshTimerRef.current = null;
      }, 800);
    }
    lastDoneCountRef.current = doneCount;
  }, [doneCount, router]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  // Items enrichis avec l'intent "create" hérité du dernier enqueue.
  // Recomputé quand items OU intentMap change. Purge côté "cleanup" : quand
  // un item terminé disparaît des items (dismiss), sa clé peut rester dans
  // intentMap ; on la laisse là — la Map est petite et repartitionnée à
  // chaque enqueue "create", pas de risque de fuite mémoire critique.
  const itemsWithIntent = useMemo(() => {
    if (intentMap.size === 0) return items;
    return items.map((it) => {
      const k = intentKey(it.productId, it.marketplace, it.mode);
      const intent = intentMap.get(k);
      return intent ? { ...it, intent } : it;
    });
  }, [items, intentMap]);

  // ── Valeurs dérivées exposées au widget et aux pages admin ────────
  const runningCount = itemsWithIntent.filter((i) => i.status === "in_progress").length;
  const awaitingCount = itemsWithIntent.filter((i) => i.status === "awaiting_callback").length;
  const queuedCount = itemsWithIntent.filter((i) => i.status === "queued").length;
  const isAllFinished =
    itemsWithIntent.length > 0 && runningCount === 0 && queuedCount === 0 && awaitingCount === 0;

  const inFlightProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of itemsWithIntent) {
      if (isItemActive(item)) set.add(item.productId);
    }
    return set;
  }, [itemsWithIntent]);

  const getRecentClientSuccessAt = useCallback(
    (productId: string, marketplace: MarketplaceTarget): number | null => {
      const ts = clientSuccessMap.get(clientSuccessKey(productId, marketplace));
      if (ts === undefined) return null;
      if (Date.now() - ts > CLIENT_SUCCESS_WINDOW_MS) return null;
      return ts;
    },
    [clientSuccessMap],
  );

  const value: MarketplaceRefreshContextValue = {
    items: itemsWithIntent,
    enqueue,
    clear,
    stop,
    dismiss,
    retry,
    isAllFinished,
    runningCount,
    queuedCount,
    inFlightProductIds,
    getRecentClientSuccessAt,
    refetch: pollOnce,
  };

  return (
    <MarketplaceRefreshContext.Provider value={value}>
      {children}
    </MarketplaceRefreshContext.Provider>
  );
}
