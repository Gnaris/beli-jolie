# Fonctionnalités retirées — journal de rollback

Ce fichier note les fonctionnalités supprimées du code source pour qu'on puisse les remettre en état si besoin. Le code entier reste dans l'historique git.

---

## 2026-08-31 — Déduction manuelle de stock des commandes marketplaces

### Ce qui a été retiré

**UI**
- Bouton **« Déduire stock PFS »** sur `/admin/produits` (hero de la page).
- **Colonne « Stock »** du tableau des commandes marketplaces (`/admin/commandes?source=marketplaces` et `/admin/commandes?source=pfs`) — plus de badge « À déduire / Déduit / Rien à déduire ».
- Bouton unitaire **« Déduire »** dans la colonne Stock (par commande).
- Actions bulk **« Déduire le stock »** et **« Marquer comme déjà déduites »** de la barre d'actions du tableau.
- Filtre déroulant **« Stock : … »** dans la barre de filtres du tableau.
- Modales de prévisualisation (globale PFS, unitaire PFS/eFashion/Faire/Ankor).

**Serveur**
- 4 server actions par marketplace : `previewXxxOrderStockDeduction`, `runXxxOrderStockDeductionOne` (PFS/eFashion/Faire).
- Bulk : `bulkDeductMarketplaceOrders`, `bulkMarkMarketplaceOrdersAsDeducted`.
- Globale PFS : `getPendingPfsStockDeductionCount`, `getPfsStockDeductionPreview`, `runPfsStockDeduction`.
- Compute maps `computePfsStockDeductionMap` / `computeEfashionStockDeductionMap` / `computeAnkorstoreStockDeductionMap` / `computeFaireStockDeductionMap` / `computeMicrostoreStockDeductionMap` dans `marketplace-orders.ts`.
- Types `MarketplaceStockDeductionState`, `PfsStockDeductionState`, `PfsNothingToDeductReason` et le champ `stockDeductionState` sur les listings.

**Libs supprimées**
- `lib/pfs-stock-deduction.ts`
- `lib/efashion-stock-deduction.ts`
- `lib/faire-stock-deduction.ts`
- `lib/orderchamp-stock-deduction.ts`
- `lib/microstore-stock-deduction.ts`
- `lib/ankorstore-stock-deduction.ts`

**Tests supprimés**
- `__tests__/integration/pfs-stock-deduction.test.ts`
- `__tests__/lib/efashion-stock-deduction-helpers.test.ts`

**Script supprimé**
- `scripts/mark-issyma-marketplace-orders-deducted.ts`

### Ce qui reste en place volontairement

**Colonnes Prisma conservées** (utiles au rollback, ne sont plus jamais écrites après la suppression) :

| Table | Colonne |
|---|---|
| `PfsOrderItem` | `stockDeductedAt`, `stockDeductionExcludedAt` |
| `EfashionOrderItem` | `stockDeductedAt` |
| `AnkorstoreOrderItem` | `stockDeductedAt` |
| `FaireOrderItem` | `stockDeductedAt` |
| `OrderchampOrderItem` | `stockDeductedAt` |
| `MicrostoreOrderItem` | `stockDeductedAt` |

**Préservation au re-sync conservée** : les 6 fichiers `lib/*-orders-sync.ts` gardent le snapshot `stockDeductedAt` avant de rebuild les items. Ça protège les timestamps déjà posés en base (notamment Issyma qui a été marquée en batch) au cas où la feature revient un jour.

### Comment retrouver le code

Dernier commit avec la feature active : **`e57aef60`** (2026-08-31, juste avant cette suppression).

```
git show e57aef60 -- lib/pfs-stock-deduction.ts
git checkout e57aef60 -- lib/pfs-stock-deduction.ts  # pour restaurer un fichier
```

Le commit de suppression est le suivant dans `git log --oneline` (à identifier après merge).

### Raison de la suppression

Demande cliente 2026-08-31 : la feature n'est plus utilisée en pratique, on veut alléger l'interface. Possibilité de la remettre plus tard, d'où la conservation des colonnes DB et des snapshots au re-sync.
