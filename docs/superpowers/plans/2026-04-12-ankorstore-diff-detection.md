# Ankorstore Diff Detection & Selective Republish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect field-by-field differences between local products and their Ankorstore listings, display them in a comparison modal, and allow selective re-publishing of specific fields.

**Architecture:** API route fetches live Ankorstore data and compares with what we'd push (local data + markup). Banner shows diff status. Modal shows side-by-side comparison with checkboxes. Server action constructs hybrid payload (BJ values for selected fields, Ankorstore values for unselected) and pushes.

**Tech Stack:** Next.js 16 API route, React modal component, Ankorstore JSON:API, marketplace-pricing markup system.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `lib/ankorstore-api.ts` | Modify | Extend interfaces + parsing for weight/dimensions/country |
| `app/api/admin/ankorstore/live-check/[productId]/route.ts` | Create | API route: load local + fetch Ankorstore, compare, return diffs |
| `components/admin/ankorstore/AnkorstoreSyncBanner.tsx` | Rewrite | Add diff detection states, "Voir les differences" button |
| `components/admin/ankorstore/AnkorstoreLiveCompareModal.tsx` | Create | Side-by-side comparison modal with checkboxes |
| `app/actions/admin/ankorstore.ts` | Modify | Add `applyAnkorstoreSelectivePublish` server action |

---

### Task 1: Extend Ankorstore API interfaces for additional fields

**Files:**
- Modify: `lib/ankorstore-api.ts:19-115`

The current `AnkorstoreProduct` interface only captures name/description/images/active/archived. The Ankorstore JSON:API response likely includes additional attributes (weight, dimensions, country) that we need for comparison.

- [ ] **Step 1: Extend AnkorstoreProduct interface**

Add optional fields to `AnkorstoreProduct` (after line 37):

```typescript
export interface AnkorstoreProduct {
  id: string;
  name: string;
  description: string;
  images: string[];
  active: boolean;
  archived: boolean;
  variants: AnkorstoreVariant[];
  // Extended fields for diff detection
  wholesalePrice: number | null;
  retailPrice: number | null;
  weight: number | null;          // grams
  height: number | null;          // mm
  width: number | null;           // mm
  length: number | null;          // mm
  madeInCountry: string | null;   // ISO Alpha-2
  vatRate: number | null;
}
```

- [ ] **Step 2: Update parseProduct to extract extended fields**

In `parseProduct()` (line 83), add extraction from `attrs`:

```typescript
function parseProduct(
  resource: JsonApiResource,
  includedMap: Map<string, JsonApiResource>
): AnkorstoreProduct {
  const attrs = resource.attributes;
  // ... existing variant resolution code ...

  return {
    // ... existing fields ...
    wholesalePrice: (attrs.wholesale_price as number) ?? (attrs.wholesalePrice as number) ?? null,
    retailPrice: (attrs.retail_price as number) ?? (attrs.retailPrice as number) ?? null,
    weight: (attrs.weight as number) ?? null,
    height: (attrs.height as number) ?? null,
    width: (attrs.width as number) ?? null,
    length: (attrs.length as number) ?? null,
    madeInCountry: (attrs.made_in_country as string) ?? (attrs.madeInCountry as string) ?? null,
    vatRate: (attrs.vat_rate as number) ?? (attrs.vatRate as number) ?? null,
  };
}
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors (existing code doesn't destructure these fields so adding them is safe).

- [ ] **Step 4: Commit**

```bash
git add lib/ankorstore-api.ts
git commit -m "feat(ankorstore): extend product interface with weight/dimensions/country for diff detection"
```

---

### Task 2: Create live-check API route

**Files:**
- Create: `app/api/admin/ankorstore/live-check/[productId]/route.ts`

This route follows the same pattern as `app/api/admin/pfs-sync/live-check/[productId]/route.ts`:
1. Auth check (admin only)
2. Load local product from DB
3. Reconstruct what we'd push (same logic as `pushProductToAnkorstoreInternal`)
4. Fetch live data from Ankorstore API
5. Compare field-by-field
6. Return `{ existing, ankorstore, differences, hasDifferences }`

- [ ] **Step 1: Create the route file**

Create `app/api/admin/ankorstore/live-check/[productId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { ankorstoreSearchProductsByRef, ankorstoreFetchProduct } from "@/lib/ankorstore-api";
import type { AnkorstoreProduct } from "@/lib/ankorstore-api";
import { loadMarketplaceMarkupConfigs, applyMarketplaceMarkup } from "@/lib/marketplace-pricing";

// ─── Types for comparison ────────────────────────────────────────

interface DiffField {
  field: string;
  bjValue: unknown;
  ankorsValue: unknown;
}

interface FormattedVariant {
  colorId: string;
  colorName: string;
  saleType: "UNIT" | "PACK";
  sku: string;
  stock: number;
  wholesalePrice: number;
  retailPrice: number;
  originalPrice: number;
}

interface FormattedProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  wholesalePrice: number;
  retailPrice: number;
  weight: number | null;        // grams
  height: number | null;        // mm
  width: number | null;         // mm
  length: number | null;        // mm
  madeInCountry: string | null;
  compositionText: string | null;
  variants: FormattedVariant[];
}

// ─── GET handler ─────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  // 1. Auth
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    // 2. Load local product (same query shape as pushProductToAnkorstoreInternal)
    const prod = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, reference: true, description: true,
        ankorsProductId: true,
        dimensionLength: true, dimensionWidth: true, dimensionHeight: true,
        dimensionDiameter: true, dimensionCircumference: true,
        manufacturingCountry: { select: { isoCode: true, name: true } },
        compositions: {
          include: { composition: { select: { name: true } } },
          orderBy: { percentage: "desc" as const },
        },
        colors: {
          orderBy: { isPrimary: "desc" as const },
          select: {
            id: true, saleType: true, stock: true, unitPrice: true,
            packQuantity: true, weight: true,
            color: { select: { name: true } },
            images: { orderBy: { order: "asc" as const }, select: { path: true } },
            packColorLines: {
              select: { colors: { select: { color: { select: { name: true } } }, orderBy: { position: "asc" as const } } },
              orderBy: { position: "asc" as const },
            },
            variantSizes: {
              select: { size: { select: { name: true } }, quantity: true },
              orderBy: { size: { position: "asc" as const } },
            },
          },
        },
      },
    });

    if (!prod) {
      return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
    }

    if (!prod.ankorsProductId) {
      return NextResponse.json({ error: "Produit non lie a Ankorstore", notLinked: true }, { status: 400 });
    }

    // 3. Load markup configs
    const markupConfigs = await loadMarketplaceMarkupConfigs();

    // 4. Reconstruct what we'd push (BJ formatted) — mirrors pushProductToAnkorstoreInternal logic
    type ProdColor = typeof prod.colors[number];
    function variantColorLabel(c: ProdColor): string {
      if (c.saleType === "UNIT") return c.color?.name ?? "Default";
      const lineColors = c.packColorLines?.[0]?.colors?.map((pc) => pc.color.name) ?? [];
      return lineColors.length > 0 ? lineColors.join("-") : "Pack";
    }
    function variantSizeEntries(c: ProdColor): { name: string; quantity: number }[] {
      const entries = c.variantSizes?.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })) ?? [];
      return entries.length > 0 ? entries : [{ name: "TU", quantity: 1 }];
    }
    function truncateSku(sku: string): string {
      return sku.length > 50 ? sku.slice(0, 50) : sku;
    }

    const bjVariants: FormattedVariant[] = [];
    for (const c of prod.colors) {
      const colorName = variantColorLabel(c);
      const sizes = variantSizeEntries(c);
      const unitPrice = Number(c.unitPrice ?? 0);
      if (unitPrice <= 0) continue;

      if (c.saleType === "UNIT") {
        const unitWholesale = applyMarketplaceMarkup(unitPrice, markupConfigs.ankorstoreWholesale);
        const unitRetail = applyMarketplaceMarkup(unitWholesale, markupConfigs.ankorstoreRetail);
        for (const sz of sizes) {
          bjVariants.push({
            colorId: c.id,
            colorName,
            saleType: "UNIT",
            sku: truncateSku(`${prod.reference}_${colorName}_${sz.name}`),
            stock: c.stock,
            wholesalePrice: unitWholesale,
            retailPrice: unitRetail,
            originalPrice: unitPrice,
          });
        }
      }

      if (c.saleType === "PACK") {
        const packQty = c.packQuantity ?? 12;
        const totalQty = c.variantSizes?.reduce((sum, vs) => sum + vs.quantity, 0) || packQty;
        const perUnitPrice = Math.round((unitPrice / totalQty) * 100) / 100;
        const markedUpUnit = applyMarketplaceMarkup(perUnitPrice, markupConfigs.ankorstoreWholesale);
        const packWholesale = Math.round(markedUpUnit * totalQty * 100) / 100;
        const packRetail = applyMarketplaceMarkup(packWholesale, markupConfigs.ankorstoreRetail);
        for (const sz of sizes) {
          bjVariants.push({
            colorId: c.id,
            colorName,
            saleType: "PACK",
            sku: truncateSku(`${prod.reference}_${colorName}_Pack${packQty}_${sz.name}`),
            stock: c.stock,
            wholesalePrice: packWholesale,
            retailPrice: packRetail,
            originalPrice: unitPrice,
          });
        }
      }
    }

    const basePrice = Number(
      prod.colors.find((c) => c.saleType === "UNIT")?.unitPrice ?? prod.colors[0]?.unitPrice ?? 0
    );
    const title = `${prod.name} - ${prod.reference}`;
    const compositionText = prod.compositions.length > 0
      ? prod.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ")
      : null;
    const dimParts: string[] = [];
    if (prod.dimensionLength) dimParts.push(`Longueur ${prod.dimensionLength} mm`);
    if (prod.dimensionWidth) dimParts.push(`Largeur ${prod.dimensionWidth} mm`);
    if (prod.dimensionHeight) dimParts.push(`Hauteur ${prod.dimensionHeight} mm`);
    if (prod.dimensionDiameter) dimParts.push(`Diametre ${prod.dimensionDiameter} mm`);
    if (prod.dimensionCircumference) dimParts.push(`Circonference ${prod.dimensionCircumference} mm`);
    const dimensionText = dimParts.length > 0 ? dimParts.join(" x ") : null;
    const maxWeightKg = Math.max(0, ...prod.colors.map((c) => c.weight ?? 0));
    const weightGrams = maxWeightKg > 0 ? Math.round(maxWeightKg * 1000) : null;

    let desc = prod.description ?? "";
    if (compositionText) desc += `\nComposition : ${compositionText}`;
    if (dimensionText) desc += `\nDimensions : ${dimensionText}`;
    if (maxWeightKg > 0) desc += `\nPoids : ${maxWeightKg} kg`;
    desc += `\nReference : ${prod.reference}`;
    if (desc.length < 30) desc = `${prod.name}. ${desc}`;

    const bjFormatted: FormattedProduct = {
      id: prod.id,
      reference: prod.reference,
      name: title,
      description: desc,
      wholesalePrice: applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
      retailPrice: applyMarketplaceMarkup(
        applyMarketplaceMarkup(basePrice, markupConfigs.ankorstoreWholesale),
        markupConfigs.ankorstoreRetail
      ),
      weight: weightGrams,
      height: prod.dimensionHeight ?? null,
      width: prod.dimensionWidth ?? null,
      length: prod.dimensionLength ?? null,
      madeInCountry: prod.manufacturingCountry?.isoCode ?? null,
      compositionText,
      variants: bjVariants,
    };

    // 5. Fetch live Ankorstore data
    let ankorsProduct: AnkorstoreProduct | null = null;

    // Try direct fetch by product ID first (if ankorsProductId is a UUID)
    try {
      ankorsProduct = await ankorstoreFetchProduct(prod.ankorsProductId);
    } catch {
      // ankorsProductId might be the reference, not a UUID — search by ref
      logger.info("[Ankorstore LiveCheck] Direct fetch failed, searching by reference", { ankorsProductId: prod.ankorsProductId });
    }

    if (!ankorsProduct) {
      const products = await ankorstoreSearchProductsByRef(prod.reference);
      ankorsProduct = products[0] ?? null;
    }

    if (!ankorsProduct) {
      return NextResponse.json({ error: "Produit non trouve sur Ankorstore", notOnAnkorstore: true }, { status: 400 });
    }

    // 6. Format Ankorstore data for comparison
    const ankorsVariants: FormattedVariant[] = ankorsProduct.variants.map((v) => {
      // Parse color and size from SKU: {ref}_{color}_{size} or {ref}_{color}_Pack{n}_{size}
      const skuParts = v.sku?.split("_") ?? [];
      const colorName = skuParts.length >= 2 ? skuParts[1] : v.name;
      const isPack = v.sku?.includes("_Pack") ?? false;

      return {
        colorId: v.id,
        colorName,
        saleType: isPack ? "PACK" as const : "UNIT" as const,
        sku: v.sku ?? "",
        stock: v.availableQuantity ?? 0,
        wholesalePrice: v.wholesalePrice ?? 0,
        retailPrice: v.retailPrice ?? 0,
        originalPrice: 0,
      };
    });

    const ankorsFormatted: FormattedProduct = {
      id: ankorsProduct.id,
      reference: prod.reference,
      name: ankorsProduct.name,
      description: ankorsProduct.description,
      wholesalePrice: ankorsProduct.wholesalePrice ?? 0,
      retailPrice: ankorsProduct.retailPrice ?? 0,
      weight: ankorsProduct.weight,
      height: ankorsProduct.height,
      width: ankorsProduct.width,
      length: ankorsProduct.length,
      madeInCountry: ankorsProduct.madeInCountry,
      compositionText: null, // Ankorstore embeds in description
      variants: ankorsVariants,
    };

    // 7. Compute differences
    const differences: DiffField[] = [];

    // Product-level comparisons
    if (bjFormatted.name.trim() !== ankorsFormatted.name.trim()) {
      differences.push({ field: "name", bjValue: bjFormatted.name, ankorsValue: ankorsFormatted.name });
    }

    // Description: normalize whitespace for comparison
    const bjDescNorm = bjFormatted.description.replace(/\s+/g, " ").trim();
    const ankorsDescNorm = ankorsFormatted.description.replace(/\s+/g, " ").trim();
    if (bjDescNorm !== ankorsDescNorm) {
      differences.push({ field: "description", bjValue: bjFormatted.description, ankorsValue: ankorsFormatted.description });
    }

    // Wholesale price (product-level)
    if (ankorsFormatted.wholesalePrice > 0 && Math.abs(bjFormatted.wholesalePrice - ankorsFormatted.wholesalePrice) > 0.01) {
      differences.push({ field: "wholesalePrice", bjValue: bjFormatted.wholesalePrice, ankorsValue: ankorsFormatted.wholesalePrice });
    }

    // Weight (grams)
    if (bjFormatted.weight && ankorsFormatted.weight && Math.abs(bjFormatted.weight - ankorsFormatted.weight) > 1) {
      differences.push({ field: "weight", bjValue: bjFormatted.weight, ankorsValue: ankorsFormatted.weight });
    }

    // Dimensions
    if (bjFormatted.height && ankorsFormatted.height && bjFormatted.height !== ankorsFormatted.height) {
      differences.push({ field: "height", bjValue: bjFormatted.height, ankorsValue: ankorsFormatted.height });
    }
    if (bjFormatted.width && ankorsFormatted.width && bjFormatted.width !== ankorsFormatted.width) {
      differences.push({ field: "width", bjValue: bjFormatted.width, ankorsValue: ankorsFormatted.width });
    }
    if (bjFormatted.length && ankorsFormatted.length && bjFormatted.length !== ankorsFormatted.length) {
      differences.push({ field: "length", bjValue: bjFormatted.length, ankorsValue: ankorsFormatted.length });
    }

    // Country
    if (bjFormatted.madeInCountry && ankorsFormatted.madeInCountry
      && bjFormatted.madeInCountry.toUpperCase() !== ankorsFormatted.madeInCountry.toUpperCase()) {
      differences.push({ field: "madeInCountry", bjValue: bjFormatted.madeInCountry, ankorsValue: ankorsFormatted.madeInCountry });
    }

    // Variant comparisons — match by SKU
    const ankorsVariantBySku = new Map(ankorsVariants.map((v) => [v.sku, v]));
    for (const bjV of bjVariants) {
      const ankV = ankorsVariantBySku.get(bjV.sku);
      if (!ankV) {
        differences.push({ field: `variant_missing_${bjV.sku}`, bjValue: bjV, ankorsValue: null });
        continue;
      }
      if (Math.abs(bjV.wholesalePrice - ankV.wholesalePrice) > 0.01) {
        differences.push({ field: `variant_price_${bjV.sku}`, bjValue: bjV.wholesalePrice, ankorsValue: ankV.wholesalePrice });
      }
      if (bjV.stock !== ankV.stock) {
        differences.push({ field: `variant_stock_${bjV.sku}`, bjValue: bjV.stock, ankorsValue: ankV.stock });
      }
      ankorsVariantBySku.delete(bjV.sku);
    }
    // Variants on Ankorstore not in BJ
    for (const [sku, ankV] of ankorsVariantBySku) {
      differences.push({ field: `variant_extra_${sku}`, bjValue: null, ankorsValue: ankV });
    }

    if (differences.length > 0) {
      logger.info("[Ankorstore LiveCheck] Differences found", {
        productId, reference: prod.reference,
        count: differences.length,
        fields: differences.map((d) => d.field),
      });
    }

    return NextResponse.json({
      existing: bjFormatted,
      ankorstore: ankorsFormatted,
      differences,
      hasDifferences: differences.length > 0,
      countryName: prod.manufacturingCountry?.name ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore LiveCheck] Failed", { productId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/ankorstore/live-check/
git commit -m "feat(ankorstore): add live-check API route for diff detection"
```

---

### Task 3: Rewrite AnkorstoreSyncBanner with diff detection

**Files:**
- Rewrite: `components/admin/ankorstore/AnkorstoreSyncBanner.tsx`

Rewrite the banner to follow the PFS banner pattern:
- Auto-check on mount if product is linked
- States: `checking | synced | has_diffs | not_found | pushing | error`
- "Voir les differences" button opens compare modal
- "Re-publier" button for quick full republish
- Improved UX: show diff count badge, last sync time, smoother transitions

The banner calls `/api/admin/ankorstore/live-check/[productId]` instead of the server action `checkAnkorstoreProduct`.

- [ ] **Step 1: Rewrite the banner**

Full rewrite of `components/admin/ankorstore/AnkorstoreSyncBanner.tsx`:

```typescript
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { pushSingleProductToAnkorstore } from "@/app/actions/admin/ankorstore";
import AnkorstoreLiveCompareModal from "./AnkorstoreLiveCompareModal";

interface Props {
  productId: string;
  productReference: string;
  ankorsProductId: string | null;
  ankorsSyncStatus: "synced" | "pending" | "failed" | null;
  ankorsSyncError: string | null;
  ankorsSyncedAt: string | null;
}

type BannerStatus =
  | "checking"
  | "synced"
  | "has_diffs"
  | "not_found"
  | "pushing"
  | "push_success"
  | "error";

export default function AnkorstoreSyncBanner({
  productId,
  productReference,
  ankorsProductId: initialAnkorsId,
  ankorsSyncStatus,
  ankorsSyncError,
  ankorsSyncedAt,
}: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<BannerStatus>(() => {
    if (ankorsSyncStatus === "failed") return "error";
    return initialAnkorsId ? "checking" : "not_found";
  });
  const [error, setError] = useState<string | null>(ankorsSyncError);
  const [diffCount, setDiffCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const cachedData = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("checking");
    setError(null);

    try {
      const res = await fetch(`/api/admin/ankorstore/live-check/${productId}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 400 && data?.notLinked) {
          setStatus("not_found");
          return;
        }
        if (res.status === 400 && data?.notOnAnkorstore) {
          setStatus("not_found");
          return;
        }
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const data = await res.json();
      cachedData.current = data;

      if (!data.hasDifferences) {
        setStatus("synced");
        setDiffCount(0);
      } else {
        setDiffCount(data.differences.length);
        setStatus("has_diffs");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [productId]);

  const handlePush = useCallback(async () => {
    setStatus("pushing");
    setError(null);
    try {
      const result = await pushSingleProductToAnkorstore(productId);
      if (result.success) {
        setStatus("synced");
        setDiffCount(0);
        cachedData.current = null;
        toast.success("Ankorstore", "Produit publie sur Ankorstore avec succes.");
      } else {
        setError(result.error ?? "Echec de la publication");
        setStatus("error");
        toast.error("Ankorstore", result.error ?? "Echec de la publication sur Ankorstore.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
    }
  }, [productId, toast]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    cachedData.current = null;
    if (initialAnkorsId) runCheck();
  }, [initialAnkorsId, runCheck]);

  // Auto-check on mount if linked
  useEffect(() => {
    if (!initialAnkorsId) return;
    if (ankorsSyncStatus === "failed") return;
    const timer = setTimeout(() => runCheck(), 300);
    return () => clearTimeout(timer);
  }, [productId, initialAnkorsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ... render states (checking, synced, has_diffs, not_found, pushing, error)
  // Full JSX follows the same visual pattern as PFS banner
  // See implementation for complete render code
}
```

Key UX improvements vs current banner:
- **Diff count badge**: amber badge showing number of differences
- **Last synced time**: shows relative time since last sync
- **Smooth state transitions**: no flicker between states
- **Compare modal integration**: "Voir les differences" button opens modal with cached data

- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit**

---

### Task 4: Create AnkorstoreLiveCompareModal

**Files:**
- Create: `components/admin/ankorstore/AnkorstoreLiveCompareModal.tsx`

Side-by-side comparison modal inspired by PFS's `PfsLiveCompareModal` but adapted for unidirectional flow:

- Left column: Boutique (BJ) values — what we'd push
- Right column: Ankorstore values — what's currently live
- Checkbox per field: "Re-publier ce champ" (checked by default for fields with differences)
- Footer: "Publier X champ(s) selectionne(s)" button + "Tout publier" shortcut

Field sections:
1. **Informations** — Nom, Description (collapsible for long text)
2. **Tarifs** — Prix wholesale product-level
3. **Specifications** — Poids, Dimensions (H/L/l), Pays
4. **Composition** — Extracted from description
5. **Variantes** — Per-variant cards showing stock + prix wholesale, with individual checkboxes

Color coding:
- Fields with differences: amber highlight
- Fields identical: green subtle
- Missing on one side: red/gray

- [ ] **Step 1: Create the modal component**

Full component in `components/admin/ankorstore/AnkorstoreLiveCompareModal.tsx`. Uses `createPortal` for modal overlay. Calls `applyAnkorstoreSelectivePublish` server action on submit.

- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit**

---

### Task 5: Add selective re-publish server action

**Files:**
- Modify: `app/actions/admin/ankorstore.ts`

Add `applyAnkorstoreSelectivePublish(productId, selectedFields)` that:
1. Loads local product (same as push)
2. Fetches current Ankorstore data
3. Constructs a hybrid `AnkorstorePushProduct` payload:
   - For selected fields: use BJ values
   - For unselected fields: use current Ankorstore values
4. Pushes the hybrid payload via `ankorstorePushProducts`

Since the Ankorstore API replaces the full product on each push, we need to send ALL fields — but only override the selected ones with BJ values.

```typescript
export async function applyAnkorstoreSelectivePublish(
  productId: string,
  selectedFields: string[]  // e.g. ["name", "description", "variant_price_REF_Red_S", "variant_stock_REF_Red_S"]
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  
  // If all product-level fields + all variant fields selected → just do full push
  // Otherwise build hybrid payload
  
  // ... implementation
}
```

- [ ] **Step 1: Add the server action**
- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit**

---

### Task 6: Wire banner into product edit page & verify

**Files:**
- Check: wherever `AnkorstoreSyncBanner` is rendered (product edit page)

Ensure the banner receives the new `ankorsSyncedAt` prop. Verify the full flow works end-to-end.

- [ ] **Step 1: Check current banner usage and add missing props**
- [ ] **Step 2: Manual test: open a linked product, verify diff detection**
- [ ] **Step 3: Manual test: open modal, toggle checkboxes, selective republish**
- [ ] **Step 4: Final commit**
