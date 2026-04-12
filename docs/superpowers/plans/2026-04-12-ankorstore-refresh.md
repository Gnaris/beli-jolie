# Ankorstore Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add product refresh on Ankorstore (delete + re-import as "new") alongside the existing PFS refresh, with a unified confirmation dialog showing marketplace checkboxes.

**Architecture:** Create `lib/ankorstore-refresh.ts` for the delete→re-import logic, an API route to trigger it async, and extend the existing `RefreshButton` with marketplace checkboxes in the confirmation dialog. Reuse `PfsRefreshContext` pattern for Ankorstore queue management.

**Tech Stack:** Next.js 16, Prisma 5.22, Ankorstore Catalog Integrations API (bulk operations), existing `ankorstoreDeleteProduct` + `pushProductToAnkorstoreInternal`

---

### Task 1: Create `lib/ankorstore-refresh.ts` — Core refresh logic

**Files:**
- Create: `lib/ankorstore-refresh.ts`

- [ ] **Step 1: Create the refresh function**

This function orchestrates: search SKUs → delete from Ankorstore → wait → re-push as "import". It reuses existing functions from `lib/ankorstore-api.ts`, `lib/ankorstore-api-write.ts`, and `app/actions/admin/ankorstore.ts`.

```typescript
/**
 * Ankorstore Refresh — Delete + re-import a product to make it appear as "new"
 *
 * Flow:
 * 1. Search Ankorstore for existing variant SKUs
 * 2. Delete the product from Ankorstore (3-step async operation)
 * 3. Clear local ankorsProductId so re-push treats it as "import"
 * 4. Re-push the product as a new import
 * 5. Update local createdAt → now
 */

import { prisma } from "@/lib/prisma";
import { ankorstoreSearchVariants } from "@/lib/ankorstore-api";
import { ankorstoreDeleteProduct } from "@/lib/ankorstore-api-write";
import { pushProductToAnkorstoreInternal } from "@/app/actions/admin/ankorstore";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";

export interface AnkorstoreRefreshProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

type ProgressCallback = (progress: AnkorstoreRefreshProgress) => void;

export async function ankorstoreRefreshProduct(
  productId: string,
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; error?: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      reference: true,
      ankorsProductId: true,
    },
  });

  if (!product) return { success: false, error: "Produit introuvable" };
  if (!product.ankorsProductId) return { success: false, error: "Produit non synchronisé avec Ankorstore" };

  const progress: AnkorstoreRefreshProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };

  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  try {
    // ── Step 1: Search Ankorstore for existing variant SKUs ──
    report("Recherche des variantes sur Ankorstore...");
    const ankorsVariants = await ankorstoreSearchVariants({ skuOrName: product.reference });
    const skus = ankorsVariants
      .map((v) => v.sku)
      .filter((s): s is string => !!s && s.startsWith(product.reference));

    if (skus.length === 0) {
      logger.warn("[Ankorstore Refresh] No variants found, skipping delete step", { reference: product.reference });
    }

    // ── Step 2: Delete from Ankorstore ──
    if (skus.length > 0) {
      report(`Suppression d'Ankorstore (${skus.length} variantes)...`);
      logger.info("[Ankorstore Refresh] Deleting product", { reference: product.reference, skuCount: skus.length });

      const deleteResult = await ankorstoreDeleteProduct(product.reference, skus);

      if (!deleteResult.success) {
        // Non-fatal: log warning and continue — the re-import as "update" will still work
        logger.warn("[Ankorstore Refresh] Delete failed, will attempt re-push as update", {
          reference: product.reference,
          error: deleteResult.error,
        });
      } else {
        logger.info("[Ankorstore Refresh] Delete succeeded", { reference: product.reference });
      }
    }

    // ── Step 3: Clear local link so re-push treats it as "import" ──
    report("Préparation de la re-création...");
    await prisma.product.update({
      where: { id: productId },
      data: {
        ankorsProductId: null,
        ankorsMatchedAt: null,
        ankorsSyncStatus: null,
        ankorsSyncError: null,
        ankorsSyncedAt: null,
      },
    });
    logger.info("[Ankorstore Refresh] Cleared local Ankorstore link", { productId });

    // ── Step 4: Re-push as new import ──
    report("Re-création sur Ankorstore...");
    const pushResult = await pushProductToAnkorstoreInternal(productId, "import", { skipRevalidation: true });

    if (!pushResult.success) {
      throw new Error(pushResult.error || "Échec de la re-création sur Ankorstore");
    }

    // ── Step 5: Update local createdAt ──
    report("Mise à jour de la date de création...");
    await prisma.product.update({
      where: { id: productId },
      data: { createdAt: new Date() },
    });

    // ── Step 6: Invalidate caches & notify ──
    revalidateTag("products", "default");
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });

    logger.info("[Ankorstore Refresh] Successfully refreshed product", { reference: product.reference });
    progress.status = "success";
    progress.step = "Terminé";
    onProgress?.(progress);

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore Refresh] Error refreshing product", { reference: product.reference, error: errorMsg });

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ankorstore-refresh.ts
git commit -m "feat: add Ankorstore refresh logic (delete + re-import)"
```

---

### Task 2: Create `app/api/admin/ankorstore-refresh/route.ts` — API endpoint

**Files:**
- Create: `app/api/admin/ankorstore-refresh/route.ts`

- [ ] **Step 1: Create the API route**

Same pattern as `app/api/admin/pfs-refresh/route.ts` — admin-only POST endpoint.

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ankorstoreRefreshProduct } from "@/lib/ankorstore-refresh";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  let { productId } = body as { productId?: string; reference?: string };
  const { reference } = body as { reference?: string };

  // Allow lookup by reference
  if (!productId && reference) {
    const product = await prisma.product.findFirst({
      where: { reference },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json({ error: `Produit avec référence "${reference}" introuvable` }, { status: 404 });
    }
    productId = product.id;
  }

  if (!productId) {
    return NextResponse.json({ error: "productId ou reference requis" }, { status: 400 });
  }

  const result = await ankorstoreRefreshProduct(productId, (progress) => {
    logger.info(`[Ankorstore Refresh API] ${progress.step}`);
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/ankorstore-refresh/route.ts
git commit -m "feat: add Ankorstore refresh API endpoint"
```

---

### Task 3: Create `AnkorstoreRefreshContext` — Client-side queue manager

**Files:**
- Create: `components/admin/ankorstore/AnkorstoreRefreshContext.tsx`

- [ ] **Step 1: Create the context provider**

Same pattern as `PfsRefreshContext.tsx` but calls `/api/admin/ankorstore-refresh`.

```typescript
"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnkorstoreRefreshItem {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

interface AnkorstoreRefreshContextValue {
  queue: AnkorstoreRefreshItem[];
  enqueue: (productId: string, productName: string, reference: string) => void;
  isRefreshing: (productId: string) => boolean;
  clearCompleted: () => void;
  cancelQueued: () => void;
}

const AnkorstoreRefreshContext = createContext<AnkorstoreRefreshContextValue | null>(null);

export function useAnkorstoreRefresh(): AnkorstoreRefreshContextValue | null {
  return useContext(AnkorstoreRefreshContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 1; // Ankorstore ops are slower (polling), limit to 1

export function AnkorstoreRefreshProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AnkorstoreRefreshItem[]>([]);
  const activeCountRef = useRef(0);
  const queueRef = useRef<AnkorstoreRefreshItem[]>([]);

  // Keep queueRef in sync
  queueRef.current = queue;

  const processOne = useCallback(async (item: AnkorstoreRefreshItem) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.productId === item.productId
          ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
          : q,
      ),
    );

    try {
      const res = await fetch("/api/admin/ankorstore-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: item.productId }),
      });

      const data = await res.json();

      setQueue((prev) =>
        prev.map((q) =>
          q.productId === item.productId
            ? {
                ...q,
                status: data.success ? ("success" as const) : ("error" as const),
                step: data.success ? "Terminé" : undefined,
                error: data.error,
              }
            : q,
        ),
      );
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.productId === item.productId
            ? {
                ...q,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Erreur inconnue",
              }
            : q,
        ),
      );
    }
  }, []);

  const processQueue = useCallback(async () => {
    while (true) {
      if (activeCountRef.current >= MAX_CONCURRENT) return;

      const next = queueRef.current.find((item) => item.status === "queued");
      if (!next) return;

      setQueue((prev) =>
        prev.map((q) =>
          q.productId === next.productId
            ? { ...q, status: "in_progress" as const, step: "Initialisation..." }
            : q,
        ),
      );
      queueRef.current = queueRef.current.map((q) =>
        q.productId === next.productId ? { ...q, status: "in_progress" as const } : q,
      );

      activeCountRef.current++;
      processOne(next).finally(() => {
        activeCountRef.current--;
        setTimeout(() => processQueue(), 200);
      });
    }
  }, [processOne]);

  const enqueue = useCallback(
    (productId: string, productName: string, reference: string) => {
      const existing = queueRef.current.find(
        (item) => item.productId === productId && (item.status === "queued" || item.status === "in_progress"),
      );
      if (existing) return;

      const newItem: AnkorstoreRefreshItem = {
        productId,
        productName,
        reference,
        status: "queued",
      };

      setQueue((prev) => {
        const filtered = prev.filter(
          (item) => item.productId !== productId || (item.status !== "success" && item.status !== "error"),
        );
        return [...filtered, newItem];
      });

      setTimeout(() => processQueue(), 100);
    },
    [processQueue],
  );

  const isRefreshing = useCallback(
    (productId: string) => {
      return queue.some(
        (item) => item.productId === productId && (item.status === "queued" || item.status === "in_progress"),
      );
    },
    [queue],
  );

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status === "queued" || item.status === "in_progress"));
  }, []);

  const cancelQueued = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status !== "queued"));
  }, []);

  return (
    <AnkorstoreRefreshContext.Provider value={{ queue, enqueue, isRefreshing, clearCompleted, cancelQueued }}>
      {children}
    </AnkorstoreRefreshContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ankorstore/AnkorstoreRefreshContext.tsx
git commit -m "feat: add Ankorstore refresh context (client-side queue)"
```

---

### Task 4: Create `AnkorstoreRefreshWidget` — Progress display

**Files:**
- Create: `components/admin/ankorstore/AnkorstoreRefreshWidget.tsx`

- [ ] **Step 1: Create the widget**

Same layout as `PfsRefreshWidget.tsx` but with "Ankorstore" title and using `useAnkorstoreRefresh()`.

```typescript
"use client";

import React, { useState, useEffect } from "react";
import { useAnkorstoreRefresh, type AnkorstoreRefreshItem } from "./AnkorstoreRefreshContext";

export default function AnkorstoreRefreshWidget() {
  const ctx = useAnkorstoreRefresh();
  const queue = ctx?.queue ?? [];
  const clearCompleted = ctx?.clearCompleted ?? (() => {});
  const cancelQueued = ctx?.cancelQueued ?? (() => {});
  const [minimized, setMinimized] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (queue.length === 0) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const allDone = queue.every((item) => item.status === "success" || item.status === "error");
    if (allDone) {
      const timer = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [queue]);

  if (!visible || queue.length === 0) return null;

  const inProgress = queue.filter((i) => i.status === "in_progress").length;
  const queued = queue.filter((i) => i.status === "queued").length;
  const completed = queue.filter((i) => i.status === "success").length;
  const errors = queue.filter((i) => i.status === "error").length;
  const total = queue.length;
  const allDone = inProgress === 0 && queued === 0;

  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 bg-bg-primary border border-border rounded-2xl shadow-lg overflow-hidden font-body" style={{ bottom: "9rem" }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 bg-bg-secondary border-b border-border cursor-pointer select-none"
        onClick={() => setMinimized(!minimized)}
      >
        <svg
          className={`w-4 h-4 text-text-secondary shrink-0 ${inProgress > 0 ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
          />
        </svg>
        <span className="text-sm font-medium text-text-primary flex-1">
          Rafraîchissement Ankorstore
        </span>
        <span className="text-xs text-text-muted">
          {allDone ? `${completed + errors}/${total}` : `${completed}/${total}`}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform ${minimized ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Body */}
      {!minimized && (
        <div className="max-h-60 overflow-y-auto">
          {queue.map((item) => (
            <QueueItem key={item.productId} item={item} />
          ))}
        </div>
      )}

      {/* Footer */}
      {!minimized && (allDone || queued > 0) && (
        <div className="px-4 py-2 border-t border-border flex items-center justify-between">
          {queued > 0 ? (
            <button
              onClick={cancelQueued}
              className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
            >
              Stopper la file ({queued} en attente)
            </button>
          ) : (
            <span />
          )}
          {allDone && (
            <button
              onClick={() => {
                clearCompleted();
                setVisible(false);
              }}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Fermer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QueueItem({ item }: { item: AnkorstoreRefreshItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <div className="shrink-0">
        {item.status === "queued" && (
          <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {item.status === "in_progress" && (
          <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {item.status === "success" && (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {item.status === "error" && (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{item.reference}</p>
        {item.status === "error" ? (
          <p className="text-xs text-red-500 break-words whitespace-pre-wrap">
            {item.error || "Erreur"}
          </p>
        ) : (
          <p className="text-xs text-text-muted truncate">
            {item.status === "queued" && "En attente..."}
            {item.status === "in_progress" && (item.step || "En cours...")}
            {item.status === "success" && "Terminé"}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ankorstore/AnkorstoreRefreshWidget.tsx
git commit -m "feat: add Ankorstore refresh widget (progress display)"
```

---

### Task 5: Wire `AnkorstoreRefreshProvider` + Widget into admin layout

**Files:**
- Modify: `app/(admin)/layout.tsx` (or wherever `PfsRefreshProvider` is rendered)

- [ ] **Step 1: Find where PfsRefreshProvider is mounted**

Search for `PfsRefreshProvider` in layout files to find the correct location.

```bash
grep -rn "PfsRefreshProvider" app/
```

- [ ] **Step 2: Add AnkorstoreRefreshProvider alongside PfsRefreshProvider**

Import and wrap children with both providers. Add the `AnkorstoreRefreshWidget` next to `PfsRefreshWidget`.

In the admin layout file, add:

```typescript
import { AnkorstoreRefreshProvider } from "@/components/admin/ankorstore/AnkorstoreRefreshContext";
import AnkorstoreRefreshWidget from "@/components/admin/ankorstore/AnkorstoreRefreshWidget";
```

Wrap children:
```tsx
<PfsRefreshProvider>
  <AnkorstoreRefreshProvider>
    {children}
    <PfsRefreshWidget />
    <AnkorstoreRefreshWidget />
  </AnkorstoreRefreshProvider>
</PfsRefreshProvider>
```

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/layout.tsx
git commit -m "feat: wire Ankorstore refresh provider + widget into admin layout"
```

---

### Task 6: Update `RefreshButton` — Add marketplace checkboxes

**Files:**
- Modify: `components/admin/products/RefreshButton.tsx`

- [ ] **Step 1: Update RefreshButton to accept `hasAnkorstoreConfig` and show checkboxes**

Replace the full component with:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePfsRefresh } from "@/components/admin/pfs/PfsRefreshContext";
import { useAnkorstoreRefresh } from "@/components/admin/ankorstore/AnkorstoreRefreshContext";
import { refreshProduct } from "@/app/actions/admin/products";
import { useState, useRef } from "react";

interface Props {
  href: string;
  productId?: string;
  productName?: string;
  productReference?: string;
  hasPfsConfig?: boolean;
  hasAnkorstoreConfig?: boolean;
}

export default function RefreshButton({ href, productId, productName, productReference, hasPfsConfig, hasAnkorstoreConfig }: Props) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const pfsRefresh = usePfsRefresh();
  const ankorsRefresh = useAnkorstoreRefresh();
  const [refreshing, setRefreshing] = useState(false);
  const pfsRefreshing = productId ? pfsRefresh?.isRefreshing(productId) : false;
  const ankorsRefreshing = productId ? ankorsRefresh?.isRefreshing(productId) : false;

  // Track checkbox state via refs (onChange callbacks)
  const refreshPfsRef = useRef(true);
  const refreshAnkorsRef = useRef(true);

  async function handleClick() {
    const hasAnyMarketplace = hasPfsConfig || hasAnkorstoreConfig;

    // Build checkboxes for each active marketplace
    const checkboxes: { id: string; label: string; defaultChecked: boolean; onChange: (checked: boolean) => void }[] = [];

    if (hasPfsConfig) {
      checkboxes.push({
        id: "pfs",
        label: "Rafraîchir sur Paris Fashion Shop",
        defaultChecked: true,
        onChange: (checked: boolean) => { refreshPfsRef.current = checked; },
      });
    }

    if (hasAnkorstoreConfig) {
      checkboxes.push({
        id: "ankorstore",
        label: "Rafraîchir sur Ankorstore",
        defaultChecked: true,
        onChange: (checked: boolean) => { refreshAnkorsRef.current = checked; },
      });
    }

    // Reset refs to default
    refreshPfsRef.current = true;
    refreshAnkorsRef.current = true;

    const message = "Le produit sera remis en \"Nouveauté\" avec la date du jour."
      + (hasAnyMarketplace ? "\nSur les marketplaces sélectionnées, le produit sera supprimé puis recréé comme nouveau." : "");

    const ok = await confirm({
      type: "warning",
      title: "Rafraîchir ce produit ?",
      message,
      confirmLabel: "Rafraîchir",
      ...(checkboxes.length > 0 ? { checkboxes, checkboxesLabel: "Marketplaces" } : {}),
    });
    if (!ok) return;

    setRefreshing(true);

    // Refresh createdAt locally
    if (productId) {
      try { await refreshProduct(productId); } catch { /* ignore */ }
    }

    // Enqueue PFS refresh if checked
    if (hasPfsConfig && refreshPfsRef.current && pfsRefresh && productId && productName && productReference) {
      pfsRefresh.enqueue(productId, productName, productReference);
    }

    // Enqueue Ankorstore refresh if checked
    if (hasAnkorstoreConfig && refreshAnkorsRef.current && ankorsRefresh && productId && productName && productReference) {
      ankorsRefresh.enqueue(productId, productName, productReference);
    }

    router.push(href);
    router.refresh();
    setRefreshing(false);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing || pfsRefreshing || ankorsRefreshing}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-bg-dark hover:text-text-primary transition-colors font-body ${
        refreshing || pfsRefreshing || ankorsRefreshing ? "opacity-50 cursor-wait" : ""
      }`}
      title="Rafraîchir (remettre en Nouveauté)"
    >
      <svg className={`w-4 h-4 ${refreshing || pfsRefreshing || ankorsRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
      </svg>
      Rafraîchir
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/products/RefreshButton.tsx
git commit -m "feat: add marketplace checkboxes to refresh confirmation dialog"
```

---

### Task 7: Pass `hasAnkorstoreConfig` to `RefreshButton` from the product edit page

**Files:**
- Modify: `app/(admin)/admin/produits/[id]/modifier/page.tsx`

- [ ] **Step 1: Add `hasAnkorstoreConfig` prop to RefreshButton**

Find the `<RefreshButton` usage (around line 544) and add the prop:

```tsx
<RefreshButton
  href={`/admin/produits/${product.id}/modifier`}
  productId={product.id}
  productName={product.name}
  productReference={product.reference}
  hasPfsConfig={hasPfsConfig}
  hasAnkorstoreConfig={ankorsEnabled?.value === "true"}
/>
```

The `ankorsEnabled` variable is already fetched at the top of the page component (line 31).

- [ ] **Step 2: Commit**

```bash
git add "app/(admin)/admin/produits/[id]/modifier/page.tsx"
git commit -m "feat: pass hasAnkorstoreConfig to RefreshButton"
```

---

### Task 8: Position the two widgets to not overlap

**Files:**
- Modify: `components/admin/pfs/PfsRefreshWidget.tsx`
- Modify: `components/admin/ankorstore/AnkorstoreRefreshWidget.tsx`

- [ ] **Step 1: Adjust widget positions**

The PFS widget is at `bottom-20 right-4` (bottom: 5rem). The Ankorstore widget should stack above it. In `AnkorstoreRefreshWidget.tsx`, the inline style `style={{ bottom: "9rem" }}` was already added in Task 4 to offset it above the PFS widget. Verify both widgets don't overlap.

If both are visible, PFS sits at bottom ~5rem and Ankorstore at bottom ~9rem. This is fine for single-product refresh. If needed later, they can be merged into a single widget.

- [ ] **Step 2: Commit (if changes were needed)**

```bash
git add components/admin/ankorstore/AnkorstoreRefreshWidget.tsx components/admin/pfs/PfsRefreshWidget.tsx
git commit -m "fix: adjust refresh widget positions to prevent overlap"
```

---

### Task 9: Test the full flow

- [ ] **Step 1: Build check**

```bash
npm run build
```

Fix any TypeScript errors.

- [ ] **Step 2: Manual test**

1. Start dev server: `npm run dev`
2. Navigate to a product that is synced on Ankorstore (`ankorsProductId` is set)
3. Click "Rafraîchir" button
4. Verify the confirmation dialog shows checkboxes for each active marketplace
5. Check "Ankorstore" checkbox, click "Rafraîchir"
6. Verify the Ankorstore refresh widget appears showing progress
7. Wait for completion — verify product is re-created on Ankorstore
8. Verify `createdAt` was updated in DB

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Ankorstore refresh feature"
```
