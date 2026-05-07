/**
 * Cache mémoire pour `pfsListProducts`.
 *
 * Pendant un import en lot (ex: 1000 produits), `approveAndImportPfsProduct`
 * était appelé 1000 fois et chacune re-paginait toute la liste PFS pour
 * retrouver le produit cible — d'où des dizaines d'appels HTTP redondants
 * vers Salesforce.
 *
 * Ce module sert un index `pfsId → PfsProduct` partagé entre tous les workers
 * d'import. La carte est construite **paresseusement** (la première recherche
 * paie le coût, les suivantes lisent en mémoire) et expire après `TTL_MS`.
 *
 * Le cache est aussi versionné par concurrent: invalidate() incrémente un
 * compteur, ce qui permet d'annuler proprement les chargements en cours
 * (ex: lors d'une nouvelle session d'import).
 */
import { pfsListProducts, type PfsProduct } from "@/lib/pfs-api";

const TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;

interface CacheEntry {
  index: Map<string, PfsProduct>;
  expiresAt: number;
  version: number;
}

let entry: CacheEntry | null = null;
let pending: Promise<Map<string, PfsProduct>> | null = null;
let version = 0;

function isFresh(): boolean {
  return entry !== null && entry.expiresAt > Date.now() && entry.version === version;
}

async function buildIndex(): Promise<Map<string, PfsProduct>> {
  const myVersion = version;
  const map = new Map<string, PfsProduct>();
  const first = await pfsListProducts(1, PAGE_SIZE);
  for (const p of first.data) map.set(p.id, p);
  const last = first.meta?.last_page ?? 1;
  for (let page = 2; page <= last; page++) {
    if (myVersion !== version) {
      throw new Error("PFS list cache invalidated mid-build");
    }
    const data = await pfsListProducts(page, PAGE_SIZE);
    for (const p of data.data) map.set(p.id, p);
  }
  return map;
}

async function getIndex(): Promise<Map<string, PfsProduct>> {
  if (isFresh()) return entry!.index;
  if (pending) return pending;
  const myVersion = version;
  pending = (async () => {
    try {
      const index = await buildIndex();
      if (myVersion === version) {
        entry = { index, expiresAt: Date.now() + TTL_MS, version: myVersion };
      }
      return index;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * Cherche un produit PFS par son ID. Construit l'index complet la première
 * fois, puis lit en mémoire pour tous les appels suivants.
 */
export async function getCachedPfsProductById(
  pfsId: string,
): Promise<PfsProduct | undefined> {
  const index = await getIndex();
  return index.get(pfsId);
}

/** Force un rafraîchissement du cache (ex: nouvelle session d'import). */
export function invalidatePfsListCache(): void {
  version++;
  entry = null;
  pending = null;
}

/** Pour les tests : remet le cache à un état pristine. */
export function __resetPfsListCacheForTests(): void {
  entry = null;
  pending = null;
  version = 0;
}
