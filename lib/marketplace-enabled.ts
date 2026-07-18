/**
 * lib/marketplace-enabled.ts
 *
 * Helpers autour du drapeau « marketplace activée pour ce produit »
 * (Product.pfsEnabled / ankorsEnabled / efashionEnabled / faireEnabled).
 *
 * Le drapeau permet à la cliente d'exclure un produit d'un marketplace précis.
 * Une fois désactivé, plus aucune action automatique (refresh / publish /
 * resync / stock) ne doit partir vers ce marketplace pour ce produit — même
 * si la modale de push a la case cochée.
 *
 * Points d'application :
 *  - POST /api/admin/marketplace-queue : filtre les items à l'enqueue
 *  - refreshProductOnMarketplaces : filtre les options
 *  - publishProductToMarketplaces : filtre les options
 *
 * NB : le drapeau ne supprime PAS la fiche marketplace existante — c'est la
 * modale de confirmation à la désactivation qui gère ce choix côté UI.
 */
import { prisma } from "@/lib/prisma";

export type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire";

export interface ProductMarketplaceEnabled {
  pfs: boolean;
  ankorstore: boolean;
  efashion: boolean;
  faire: boolean;
}

const DEFAULT_ENABLED: ProductMarketplaceEnabled = {
  pfs: true,
  ankorstore: true,
  efashion: true,
  faire: true,
};

/**
 * Lit les 4 drapeaux `*Enabled` d'un produit. Retourne les valeurs par défaut
 * (tout activé) si le produit est introuvable — le filtrage devient alors
 * transparent et le comportement historique est préservé.
 */
export async function getProductMarketplaceEnabled(
  productId: string,
): Promise<ProductMarketplaceEnabled> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      pfsEnabled: true,
      ankorsEnabled: true,
      efashionEnabled: true,
      faireEnabled: true,
    },
  });
  if (!row) return DEFAULT_ENABLED;
  return {
    pfs: row.pfsEnabled,
    ankorstore: row.ankorsEnabled,
    efashion: row.efashionEnabled,
    faire: row.faireEnabled,
  };
}

/**
 * Version bulk. Renvoie une Map productId → drapeaux. Les IDs introuvables
 * ne sont pas dans la Map (l'appelant décide s'il applique le défaut).
 */
export async function getProductsMarketplaceEnabled(
  productIds: string[],
): Promise<Map<string, ProductMarketplaceEnabled>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      pfsEnabled: true,
      ankorsEnabled: true,
      efashionEnabled: true,
      faireEnabled: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        pfs: r.pfsEnabled,
        ankorstore: r.ankorsEnabled,
        efashion: r.efashionEnabled,
        faire: r.faireEnabled,
      },
    ]),
  );
}

/**
 * Filtre un objet d'options `{ pfs, ankorstore, efashion, faire }` en
 * retirant les marketplaces désactivées pour ce produit. Retourne les
 * nouvelles options + la liste des marketplaces qui ont été coupées.
 */
export function filterOptionsByEnabled<
  T extends {
    pfs?: boolean;
    ankorstore?: boolean;
    efashion?: boolean;
    faire?: boolean;
  },
>(
  options: T,
  enabled: ProductMarketplaceEnabled,
): { filtered: T; skipped: MarketplaceKey[] } {
  const filtered = { ...options };
  const skipped: MarketplaceKey[] = [];
  if (options.pfs && !enabled.pfs) {
    filtered.pfs = false;
    skipped.push("pfs");
  }
  if (options.ankorstore && !enabled.ankorstore) {
    filtered.ankorstore = false;
    skipped.push("ankorstore");
  }
  if (options.efashion && !enabled.efashion) {
    filtered.efashion = false;
    skipped.push("efashion");
  }
  if (options.faire && !enabled.faire) {
    filtered.faire = false;
    skipped.push("faire");
  }
  return { filtered, skipped };
}

/**
 * Message d'erreur uniforme pour un marketplace désactivé (renvoyé dans les
 * outcomes des server actions quand une option a été filtrée).
 */
export function marketplaceDisabledMessage(marketplace: MarketplaceKey): string {
  const label = {
    pfs: "Paris Fashion Shop",
    ankorstore: "Ankorstore",
    efashion: "eFashion Paris",
    faire: "Faire",
  }[marketplace];
  return `${label} est désactivée pour ce produit. Réactivez-la dans « Publication marketplaces » de la fiche produit.`;
}
