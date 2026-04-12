# Marketplace Price Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to configure per-marketplace price markups (% or €) with rounding options, applied automatically when syncing products to PFS and Ankorstore.

**Architecture:** New `lib/marketplace-pricing.ts` helper with a pure `applyMarketplaceMarkup()` function. Settings stored as SiteConfig key-value pairs (9 new keys). UI added to the existing MarketplaceConfig component. Sync code in `pfs-reverse-sync.ts` and `ankorstore.ts` calls the helper before sending prices.

**Tech Stack:** TypeScript, Prisma SiteConfig, Next.js Server Actions, React client component.

---

### Task 1: Create `lib/marketplace-pricing.ts` helper

**Files:**
- Create: `lib/marketplace-pricing.ts`

- [ ] **Step 1: Create the marketplace pricing helper**

```typescript
// lib/marketplace-pricing.ts

export type MarkupType = "percent" | "fixed";
export type RoundingMode = "none" | "down" | "up";

export interface MarkupConfig {
  type: MarkupType;
  value: number; // 0 = no markup
  rounding: RoundingMode;
}

/**
 * Apply a marketplace markup to a base price.
 * - percent: basePrice * (1 + value/100)
 * - fixed: basePrice + value
 * Then apply rounding to 1 decimal place.
 * Returns price rounded to 2 decimal places minimum.
 */
export function applyMarketplaceMarkup(
  basePrice: number,
  config: MarkupConfig
): number {
  if (config.value === 0) return basePrice;

  let price =
    config.type === "percent"
      ? basePrice * (1 + config.value / 100)
      : basePrice + config.value;

  // Apply rounding to 1 decimal place
  switch (config.rounding) {
    case "down":
      price = Math.floor(price * 10) / 10;
      break;
    case "up":
      price = Math.ceil(price * 10) / 10;
      break;
    case "none":
    default:
      // Round to 2 decimal places (centime precision)
      price = Math.round(price * 100) / 100;
      break;
  }

  return price;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/marketplace-pricing.ts
git commit -m "feat: add marketplace pricing helper with markup + rounding"
```

---

### Task 2: Add server action to save/load marketplace markup settings

**Files:**
- Modify: `app/actions/admin/site-config.ts`

- [ ] **Step 1: Add the server action to `app/actions/admin/site-config.ts`**

Add at the end of the file:

```typescript
import type { MarkupType, RoundingMode } from "@/lib/marketplace-pricing";

export interface MarketplaceMarkupSettings {
  pfs: { type: MarkupType; value: number; rounding: RoundingMode };
  ankorstoreWholesale: { type: MarkupType; value: number; rounding: RoundingMode };
  ankorstoreRetail: { type: MarkupType; value: number; rounding: RoundingMode };
}

const MARKUP_KEYS = [
  "pfs_price_markup_type",
  "pfs_price_markup_value",
  "pfs_price_rounding",
  "ankorstore_wholesale_markup_type",
  "ankorstore_wholesale_markup_value",
  "ankorstore_wholesale_rounding",
  "ankorstore_retail_markup_type",
  "ankorstore_retail_markup_value",
  "ankorstore_retail_rounding",
] as const;

export async function updateMarketplaceMarkup(
  settings: MarketplaceMarkupSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    const pairs: { key: string; value: string }[] = [
      { key: "pfs_price_markup_type", value: settings.pfs.type },
      { key: "pfs_price_markup_value", value: String(settings.pfs.value) },
      { key: "pfs_price_rounding", value: settings.pfs.rounding },
      { key: "ankorstore_wholesale_markup_type", value: settings.ankorstoreWholesale.type },
      { key: "ankorstore_wholesale_markup_value", value: String(settings.ankorstoreWholesale.value) },
      { key: "ankorstore_wholesale_rounding", value: settings.ankorstoreWholesale.rounding },
      { key: "ankorstore_retail_markup_type", value: settings.ankorstoreRetail.type },
      { key: "ankorstore_retail_markup_value", value: String(settings.ankorstoreRetail.value) },
      { key: "ankorstore_retail_rounding", value: settings.ankorstoreRetail.rounding },
    ];

    await Promise.all(
      pairs.map(({ key, value }) =>
        prisma.siteConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    );

    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/actions/admin/site-config.ts
git commit -m "feat: add server action for marketplace markup settings"
```

---

### Task 3: Add markup config loading helper to `lib/marketplace-pricing.ts`

**Files:**
- Modify: `lib/marketplace-pricing.ts`

- [ ] **Step 1: Add the loader function**

Append to `lib/marketplace-pricing.ts`:

```typescript
import { prisma } from "@/lib/prisma";

export interface AllMarkupConfigs {
  pfs: MarkupConfig;
  ankorstoreWholesale: MarkupConfig;
  ankorstoreRetail: MarkupConfig;
}

const DEFAULT_CONFIG: MarkupConfig = { type: "percent", value: 0, rounding: "none" };

/**
 * Load all marketplace markup configs from SiteConfig.
 * Returns defaults (0 markup) for any missing keys.
 */
export async function loadMarketplaceMarkupConfigs(): Promise<AllMarkupConfigs> {
  const keys = [
    "pfs_price_markup_type",
    "pfs_price_markup_value",
    "pfs_price_rounding",
    "ankorstore_wholesale_markup_type",
    "ankorstore_wholesale_markup_value",
    "ankorstore_wholesale_rounding",
    "ankorstore_retail_markup_type",
    "ankorstore_retail_markup_value",
    "ankorstore_retail_rounding",
  ];

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: keys } },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));

  function parseConfig(prefix: string): MarkupConfig {
    const type = (map.get(`${prefix}_type`) as MarkupType) || "percent";
    const value = Number(map.get(`${prefix}_value`)) || 0;
    const rounding = (map.get(`${prefix}_rounding`) as RoundingMode) || "none";
    return { type, value, rounding };
  }

  return {
    pfs: parseConfig("pfs_price_markup"),
    ankorstoreWholesale: parseConfig("ankorstore_wholesale_markup"),
    ankorstoreRetail: parseConfig("ankorstore_retail_markup"),
  };
}
```

Note: The `prisma` import should be at the top of the file, moving it up.

- [ ] **Step 2: Commit**

```bash
git add lib/marketplace-pricing.ts
git commit -m "feat: add marketplace markup config loader from SiteConfig"
```

---

### Task 4: Integrate markup into PFS sync

**Files:**
- Modify: `lib/pfs-reverse-sync.ts`

- [ ] **Step 1: Modify `lib/pfs-reverse-sync.ts`**

At the top, add import:

```typescript
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs, type MarkupConfig } from "@/lib/marketplace-pricing";
```

Modify the `getPfsUnitPrice` function to accept and apply a markup config (lines 42-47). Change:

```typescript
function getPfsUnitPrice(variant: FullProduct["colors"][number]): number {
  const price = Number(variant.unitPrice);
  if (variant.saleType !== "PACK") return price;
  const totalQty = variant.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0) || variant.packQuantity || 1;
  return Math.round((price / totalQty) * 100) / 100;
}
```

To:

```typescript
function getPfsUnitPrice(variant: FullProduct["colors"][number], markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    const totalQty = variant.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0) || variant.packQuantity || 1;
    unitPrice = Math.round((price / totalQty) * 100) / 100;
  }
  return markup ? applyMarketplaceMarkup(unitPrice, markup) : unitPrice;
}
```

In the `syncProductToPfs` function (the main function), load the markup config near the beginning, after the product is loaded from DB but before any variant processing:

```typescript
const markupConfigs = await loadMarketplaceMarkupConfigs();
const pfsMarkup = markupConfigs.pfs;
```

Then update every call to `getPfsUnitPrice(variant)` to `getPfsUnitPrice(variant, pfsMarkup)`. There are 5 call sites:

1. Line ~670 (re-link ITEM patch): `price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),`
2. Line ~695 (batch ITEM creation): `price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),`
3. Line ~756 (re-link PACK patch): `price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),`
4. Line ~774 (batch PACK creation): `price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),`
5. Line ~829 (diff-based update): `const bjPrice = getPfsUnitPrice(v, pfsMarkup);`

- [ ] **Step 2: Commit**

```bash
git add lib/pfs-reverse-sync.ts
git commit -m "feat: apply marketplace markup to PFS sync prices"
```

---

### Task 5: Integrate markup into Ankorstore sync

**Files:**
- Modify: `app/actions/admin/ankorstore.ts`

- [ ] **Step 1: Modify `app/actions/admin/ankorstore.ts`**

Add imports at top:

```typescript
import { applyMarketplaceMarkup, loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";
```

There are 2 functions that push products to Ankorstore: single-product sync (~line 400) and bulk push (~line 550). In each, load markup configs at the start:

```typescript
const markupConfigs = await loadMarketplaceMarkupConfigs();
```

Then replace the hardcoded pricing. In both single-push and bulk-push, change the pattern:

**For UNIT variants**, change:

```typescript
wholesalePrice: unitPrice,
retailPrice: unitPrice * 2,
originalWholesalePrice: unitPrice,
```

To:

```typescript
wholesalePrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale),
retailPrice: applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreRetail),
originalWholesalePrice: unitPrice,
```

**For PACK variants**, change:

```typescript
wholesalePrice: packPrice,
retailPrice: packPrice * 2,
originalWholesalePrice: packPrice,
```

To:

```typescript
wholesalePrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreWholesale),
retailPrice: applyMarketplaceMarkup(packPrice, markupConfigs.ankorstoreRetail),
originalWholesalePrice: packPrice,
```

Also update the `basePrice` for the product-level prices (~line 482 for single, similar for bulk):

```typescript
const basePrice = Number(prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice ?? 0);
```

Where it's used as `wholesale_price` and `retail_price` in the product payload, apply the same markups:

```typescript
wholesale_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
retail_price: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreRetail),
```

There are 4 locations total (2 functions × 2 variant types + 2 product-level base prices).

- [ ] **Step 2: Commit**

```bash
git add app/actions/admin/ankorstore.ts
git commit -m "feat: apply marketplace markup to Ankorstore sync prices"
```

---

### Task 6: Add markup UI to MarketplaceConfig component

**Files:**
- Modify: `components/admin/settings/MarketplaceConfig.tsx`
- Modify: `app/(admin)/admin/parametres/page.tsx`
- Modify: `app/actions/admin/site-config.ts` (import already added in Task 2)

- [ ] **Step 1: Update `MarketplacesTab` in `page.tsx` to load existing markup settings**

In `app/(admin)/admin/parametres/page.tsx`, modify the `MarketplacesTab` function (~line 314). Add markup config loading and pass as props:

```typescript
async function MarketplacesTab() {
  const [pfsConfig, pfsEnabledRow, ankorsConfig, ankorsEnabledRow, ...markupRows] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "pfs_email" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "pfs_enabled" }, select: { value: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankors_client_id" }, select: { key: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankors_enabled" }, select: { value: true } }),
    // Markup settings
    prisma.siteConfig.findMany({
      where: {
        key: {
          in: [
            "pfs_price_markup_type", "pfs_price_markup_value", "pfs_price_rounding",
            "ankorstore_wholesale_markup_type", "ankorstore_wholesale_markup_value", "ankorstore_wholesale_rounding",
            "ankorstore_retail_markup_type", "ankorstore_retail_markup_value", "ankorstore_retail_rounding",
          ],
        },
      },
    }),
  ]);

  const markupMap = new Map((markupRows[0] as { key: string; value: string }[]).map((r) => [r.key, r.value]));

  return (
    <div className="max-w-xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm">
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">Marketplaces</h3>
        <p className="text-sm text-text-secondary font-body mb-4">Identifiants de connexion aux plateformes B2B.</p>
        <MarketplaceConfig
          hasPfsConfig={!!pfsConfig}
          pfsEnabled={pfsEnabledRow?.value === "true"}
          hasAnkorsConfig={!!ankorsConfig}
          ankorsEnabled={ankorsEnabledRow?.value === "true"}
          markupSettings={{
            pfs: {
              type: (markupMap.get("pfs_price_markup_type") as "percent" | "fixed") || "percent",
              value: Number(markupMap.get("pfs_price_markup_value")) || 0,
              rounding: (markupMap.get("pfs_price_rounding") as "none" | "down" | "up") || "none",
            },
            ankorstoreWholesale: {
              type: (markupMap.get("ankorstore_wholesale_markup_type") as "percent" | "fixed") || "percent",
              value: Number(markupMap.get("ankorstore_wholesale_markup_value")) || 0,
              rounding: (markupMap.get("ankorstore_wholesale_rounding") as "none" | "down" | "up") || "none",
            },
            ankorstoreRetail: {
              type: (markupMap.get("ankorstore_retail_markup_type") as "percent" | "fixed") || "percent",
              value: Number(markupMap.get("ankorstore_retail_markup_value")) || 0,
              rounding: (markupMap.get("ankorstore_retail_rounding") as "none" | "down" | "up") || "none",
            },
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `MarketplaceConfig.tsx` to add markup UI**

Add to the Props interface and component state:

```typescript
import {
  updatePfsCredentials,
  validatePfsCredentials,
  togglePfsEnabled,
  updateAnkorstoreCredentials,
  validateAnkorstoreCredentials,
  toggleAnkorstoreEnabled,
  updateMarketplaceMarkup,
  type MarketplaceMarkupSettings,
} from "@/app/actions/admin/site-config";
import type { MarkupType, RoundingMode } from "@/lib/marketplace-pricing";

interface MarkupState {
  type: MarkupType;
  value: number;
  rounding: RoundingMode;
}

interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
  hasAnkorsConfig: boolean;
  ankorsEnabled: boolean;
  markupSettings: {
    pfs: MarkupState;
    ankorstoreWholesale: MarkupState;
    ankorstoreRetail: MarkupState;
  };
}
```

Add state and save handler inside the component:

```typescript
// Markup state
const [pfsMarkup, setPfsMarkup] = useState<MarkupState>(markupSettings.pfs);
const [ankorsWholesaleMarkup, setAnkorsWholesaleMarkup] = useState<MarkupState>(markupSettings.ankorstoreWholesale);
const [ankorsRetailMarkup, setAnkorsRetailMarkup] = useState<MarkupState>(markupSettings.ankorstoreRetail);
const [isSavingMarkup, startSavingMarkup] = useTransition();

function handleSaveMarkup() {
  showLoading();
  startSavingMarkup(async () => {
    try {
      const result = await updateMarketplaceMarkup({
        pfs: pfsMarkup,
        ankorstoreWholesale: ankorsWholesaleMarkup,
        ankorstoreRetail: ankorsRetailMarkup,
      });
      if (result.success) {
        toast.success("Enregistré", "Majorations marketplace sauvegardées.");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    } finally {
      hideLoading();
    }
  });
}
```

Add a reusable `MarkupRow` sub-component inside the file (above the export):

```typescript
function MarkupRow({
  label,
  state,
  onChange,
}: {
  label: string;
  state: MarkupState;
  onChange: (s: MarkupState) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="font-body text-xs font-medium text-text-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={state.value}
          onChange={(e) => onChange({ ...state, value: Number(e.target.value) || 0 })}
          className="w-24 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
        />
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => onChange({ ...state, type: "percent" })}
            className={`h-9 px-3 text-sm font-body font-medium transition-colors ${
              state.type === "percent"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...state, type: "fixed" })}
            className={`h-9 px-3 text-sm font-body font-medium transition-colors ${
              state.type === "fixed"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >
            €
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-body text-xs text-text-secondary">Arrondi :</span>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            ["none", "Aucun"],
            ["down", "Inférieur"],
            ["up", "Supérieur"],
          ] as const).map(([mode, lbl]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...state, rounding: mode })}
              className={`h-8 px-3 text-xs font-body font-medium transition-colors ${
                state.rounding === mode
                  ? "bg-bg-dark text-text-inverse"
                  : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Add the markup sections in the JSX return, after the Ankorstore credentials section (before the closing `</div>`):

```tsx
{/* ─── Majorations prix ───────────────────────────────────────── */}
<div className="border-t border-border pt-4 space-y-4">
  <div>
    <h4 className="font-heading text-sm font-semibold text-text-primary mb-1">Majorations prix</h4>
    <p className="text-xs text-text-secondary font-body mb-3">
      Ajoutez un supplément aux prix envoyés aux marketplaces. Par défaut : 0 (pas de majoration).
    </p>
  </div>

  <div className="space-y-4">
    <div className="space-y-3">
      <h5 className="font-body text-xs font-semibold text-text-primary uppercase tracking-wider">Paris Fashion Shops</h5>
      <MarkupRow label="Prix HT" state={pfsMarkup} onChange={setPfsMarkup} />
    </div>

    <div className="border-t border-border pt-3 space-y-3">
      <h5 className="font-body text-xs font-semibold text-text-primary uppercase tracking-wider">Ankorstore</h5>
      <MarkupRow label="Prix wholesale (gros)" state={ankorsWholesaleMarkup} onChange={setAnkorsWholesaleMarkup} />
      <MarkupRow label="Prix retail (détail)" state={ankorsRetailMarkup} onChange={setAnkorsRetailMarkup} />
    </div>
  </div>

  <button
    type="button"
    onClick={handleSaveMarkup}
    disabled={isSavingMarkup}
    className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
  >
    {isSavingMarkup ? "Enregistrement..." : "Sauvegarder les majorations"}
  </button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add components/admin/settings/MarketplaceConfig.tsx app/(admin)/admin/parametres/page.tsx
git commit -m "feat: add marketplace markup UI in admin settings"
```

---

### Task 7: Manual testing

- [ ] **Step 1: Start dev server and verify UI**

```bash
npm run dev
```

Navigate to `/admin/parametres` > Marketplaces tab. Verify:
- The "Majorations prix" section appears below credentials
- PFS has 1 markup row, Ankorstore has 2 (wholesale + retail)
- Toggle buttons for % / € and rounding work
- Values save correctly (check toast + reload page to confirm persistence)

- [ ] **Step 2: Test PFS sync with markup**

Set PFS markup to 10% and sync a product. Verify the `price_eur_ex_vat` sent to PFS is 10% higher than the DB price.

- [ ] **Step 3: Test Ankorstore sync with markup**

Set Ankorstore wholesale markup to 2€ and retail markup to 100%. Sync a product. Verify:
- `wholesalePrice` = DB price + 2€
- `retailPrice` = DB price × 2 (100% markup)

- [ ] **Step 4: Test rounding**

Set a markup that produces a price like 3.54, test each rounding mode:
- `none` → 3.54
- `down` → 3.5
- `up` → 3.6

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: marketplace price markup with rounding for PFS and Ankorstore"
```
